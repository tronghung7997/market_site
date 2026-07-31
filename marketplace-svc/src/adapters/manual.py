from sqlalchemy import func, select

from src.adapters.base import ProviderAdapter, ProvisionResult
from src.models.service_task import ServiceTask, ServiceTaskStatus
from src.tasks.service import format_task_delivery


class ManualAdapter(ProviderAdapter):
    """Creates ServiceTask records for human-operated fulfillment (e.g. takedown)."""

    async def provision(self, order_id: int, user_config: dict) -> ProvisionResult:
        platform = user_config.get("platform", "unknown")
        target_urls_raw = user_config.get("target_urls", "")
        urls = [u.strip() for u in target_urls_raw.strip().split("\n") if u.strip()] if target_urls_raw else []

        if not urls:
            urls = [user_config.get("target_url", "N/A")]

        task_ids: list[int] = []
        tasks: list[ServiceTask] = []
        for url in urls:
            task = ServiceTask(
                order_id=order_id,
                platform=platform,
                target_url=url,
                status=ServiceTaskStatus.pending,
            )
            self.db.add(task)
            await self.db.flush()
            task_ids.append(task.id)
            tasks.append(task)

        # `data` là thứ BUYER đọc, `resource_id` là id nội bộ cho
        # get_usage/revoke — hai thứ khác nhau, xem tasks/service.py::
        # format_task_delivery. _sync_order_status ghi đè `data` bằng bản có
        # kết quả khi mọi task xong.
        return ProvisionResult(
            success=True,
            data=format_task_delivery(tasks),
            resource_id=",".join(str(tid) for tid in task_ids),
            metadata={
                "provider": "manual",
                "platform": platform,
                "task_count": len(task_ids),
                # Fulfillment là async: order chỉ delivered khi task cuối hoàn thành
                "async_fulfillment": True,
            },
        )

    async def check_health(self) -> dict:
        count_result = await self.db.execute(
            select(func.count())
            .select_from(ServiceTask)
            .where(ServiceTask.status == ServiceTaskStatus.pending)
        )
        pending = count_result.scalar() or 0

        if pending > 20:
            return {
                "status": "warning",
                "latency_ms": 0,
                "message": f"High backlog: {pending} pending tasks",
            }
        return {
            "status": "healthy",
            "latency_ms": 0,
            "message": f"{pending} pending tasks",
        }

    async def get_usage(self, resource_id: str) -> dict | None:
        try:
            task_id = int(resource_id.split(",")[0])
            task = await self.db.get(ServiceTask, task_id)
            if not task:
                return None
            return {
                "task_id": task.id,
                "status": task.status.value,
                "platform": task.platform,
                "target_url": task.target_url,
            }
        except (ValueError, IndexError):
            return None

    async def revoke(self, resource_id: str) -> bool:
        try:
            task_ids = [int(tid) for tid in resource_id.split(",")]
            for tid in task_ids:
                task = await self.db.get(ServiceTask, tid)
                if task and task.status == ServiceTaskStatus.pending:
                    task.status = ServiceTaskStatus.failed
            return True
        except Exception:
            return False
