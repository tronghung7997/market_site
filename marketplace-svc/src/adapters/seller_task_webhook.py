import httpx
import structlog

from src.adapters.base import ProvisionResult
from src.adapters.real_api import RealApiAdapter
from src.config import settings
from src.models.service_task import ServiceTask, ServiceTaskStatus
from src.tasks.service import format_task_delivery

logger = structlog.get_logger()


class SellerTaskWebhookAdapter(RealApiAdapter):
    """Automated counterpart to ManualAdapter: instead of queuing a ServiceTask
    for a human to work in /admin/tasks, POST it to the seller's own backend
    and let *them* report completion — any task_type the seller's backend
    understands, the platform never needs to.

    Order/task lifecycle is untouched: still one ServiceTask row per target
    (same as ManualAdapter), still `async_fulfillment=True` so the order sits
    `processing` until every task is terminal, still
    `tasks.service.update_task()` driving the refund/delivered/cancelled
    split — only the trigger differs (seller webhook callback instead of an
    admin clicking a dropdown). See
    src/gateway/router.py::provider_task_webhook and
    docs/superpowers/specs/2026-07-21-seller-connect-gateway-design.md §3.

    HTTP mechanics (retry/backoff/idempotency/ProviderCallLog tracing) are
    inherited from RealApiAdapter — submitting a task is the same "call an
    external backend and log every attempt" problem provisioning already
    solved, just posting to /v1/tasks instead of /provision.
    """

    async def provision(self, order_id: int, user_config: dict) -> ProvisionResult:
        platform = user_config.get("platform", "unknown")
        target_urls_raw = user_config.get("target_urls", "")
        urls = [u.strip() for u in target_urls_raw.strip().split("\n") if u.strip()] if target_urls_raw else []
        if not urls:
            urls = [user_config.get("target_url", "N/A")]

        callback_url = f"{settings.backend_base_url}/webhooks/providers/{self.provider_id}/tasks"
        task_ids: list[int] = []
        tasks: list[ServiceTask] = []
        submitted = 0
        for url in urls:
            external_id = await self._submit(order_id, platform, url, callback_url)
            task = ServiceTask(
                order_id=order_id, platform=platform, target_url=url,
                status=ServiceTaskStatus.processing if external_id else ServiceTaskStatus.failed,
                external_task_id=external_id, provider_id=self.provider_id,
            )
            self.db.add(task)
            await self.db.flush()
            task_ids.append(task.id)
            tasks.append(task)
            submitted += 1 if external_id else 0

        if submitted == 0:
            # _sync_order_status (tasks/service.py) only ever runs from inside
            # update_task() — i.e. triggered by an admin edit or a seller
            # webhook. If EVERY submission failed right here, none of those
            # tasks have an external_task_id, so no webhook can ever arrive
            # for them, and nothing else will call update_task() either — the
            # order would sit at `processing` forever with the buyer's money
            # stuck. Fail the whole provision instead so the normal failure
            # path (refund_escrow + cancelled, in
            # orders/service.py::_apply_provision_result) runs immediately.
            # The already-created `failed` ServiceTask rows stay as an audit
            # trail of what was attempted.
            return ProvisionResult(
                success=False,
                error="Không gửi được tác vụ nào tới nhà cung cấp",
                metadata={"provider": "seller_task_webhook", "task_count": len(task_ids)},
            )

        # `data` cho buyer đọc, `resource_id` là id nội bộ — xem
        # ManualAdapter.provision và tasks/service.py::format_task_delivery.
        return ProvisionResult(
            success=True,
            data=format_task_delivery(tasks),
            resource_id=",".join(str(tid) for tid in task_ids),
            metadata={
                "provider": "seller_task_webhook",
                "platform": platform,
                "task_count": len(task_ids),
                "submitted_count": submitted,
                # Submit thất bại MỘT PHẦN (không phải toàn bộ) là an toàn: các
                # task failed ngay từ đầu đã ở trạng thái terminal, nên khi
                # webhook của (các) task còn lại tới, _sync_order_status tính
                # đúng luôn — không cần xử lý gì thêm ở đây.
                "async_fulfillment": True,
            },
        )

    async def _submit(self, order_id: int, task_type: str, target: str, callback_url: str) -> str | None:
        idempotency_key = f"order-{order_id}-task-{hash(target) & 0xFFFFFFFF}"
        try:
            resp = await self._request_with_retry(
                "POST", "/v1/tasks",
                operation="submit_task",
                order_id=order_id,
                idempotency_key=idempotency_key,
                headers=self._headers(idempotency_key),
                json={
                    "order_id": order_id, "task_type": task_type, "target": target,
                    "callback_url": callback_url,
                },
            )
            if resp.status_code >= 400:
                return None
            body = resp.json()
            return body.get("external_task_id") or body.get("id")
        except httpx.HTTPError as e:
            logger.error("seller_task_webhook_submit_failed", order_id=order_id, target=target, error=str(e))
            return None

    async def get_usage(self, resource_id: str) -> dict | None:
        try:
            task_id = int(resource_id.split(",")[0])
            task = await self.db.get(ServiceTask, task_id)
            if not task:
                return None
            return {
                "task_id": task.id, "status": task.status.value,
                "platform": task.platform, "target_url": task.target_url,
                "external_task_id": task.external_task_id,
            }
        except (ValueError, IndexError):
            return None

    async def revoke(self, resource_id: str) -> bool:
        try:
            task_ids = [int(tid) for tid in resource_id.split(",")]
            for tid in task_ids:
                task = await self.db.get(ServiceTask, tid)
                if task and task.status in (ServiceTaskStatus.pending, ServiceTaskStatus.processing):
                    task.status = ServiceTaskStatus.failed
            return True
        except Exception:
            return False
