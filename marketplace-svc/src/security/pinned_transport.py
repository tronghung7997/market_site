"""HTTP transport that connects to a pre-validated DNS address.

The HTTP request URL keeps its hostname, so Host, TLS SNI, and certificate
verification remain correct. Only the TCP destination is replaced with the
public IP selected by the SSRF guard.
"""

import httpcore
import httpx


class _PinnedNetworkBackend:
    def __init__(self, hostname: str, ip_address: str) -> None:
        self._hostname = hostname.rstrip(".").lower()
        self._ip_address = ip_address
        self._backend = httpcore.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options=None,
    ):
        normalized = host.rstrip(".").lower()
        if normalized != self._hostname:
            raise httpcore.ConnectError("HTTP transport refused an unpinned hostname")
        return await self._backend.connect_tcp(
            self._ip_address,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    async def connect_unix_socket(self, path: str, timeout=None, socket_options=None):
        raise httpcore.ConnectError("Unix sockets are disabled for seller HTTP")

    async def sleep(self, seconds: float) -> None:
        await self._backend.sleep(seconds)


class PinnedAsyncHTTPTransport(httpx.AsyncHTTPTransport):
    def __init__(self, hostname: str, ip_address: str) -> None:
        # trust_env=False prevents an ambient HTTP(S)_PROXY from becoming an
        # alternate, unvalidated resolution path.
        super().__init__(trust_env=False)
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(verify=True, trust_env=False),
            network_backend=_PinnedNetworkBackend(hostname, ip_address),
        )
