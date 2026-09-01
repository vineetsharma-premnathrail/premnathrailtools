import asyncio
import httpx
from msal import ConfidentialClientApplication
from app.core.config import settings


def get_msal_app() -> ConfidentialClientApplication:
    """Get MSAL app instance for Azure AD authentication."""
    authority = f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}"
    return ConfidentialClientApplication(
        settings.AZURE_CLIENT_ID,
        authority=authority,
        client_credential=settings.AZURE_CLIENT_SECRET,
    )


def get_auth_url(state: str, redirect_uri: str) -> str:
    """Get Microsoft login authorization URL."""
    app = get_msal_app()
    scopes = ["User.Read"]
    return app.get_authorization_request_url(
        scopes=scopes,
        state=state,
        redirect_uri=redirect_uri,
        prompt="select_account",  # always show Microsoft's account picker instead of silently SSO-ing into the last account
    )


async def exchange_code_for_token(code: str, redirect_uri: str) -> dict:
    """Exchange authorization code for access token."""
    app = get_msal_app()
    result = app.acquire_token_by_authorization_code(
        code,
        scopes=["User.Read"],
        redirect_uri=redirect_uri,
    )
    if "error" in result:
        raise ValueError(f"OAuth error: {result.get('error_description')}")
    return result


async def get_microsoft_user_profile(access_token: str) -> dict:
    """Fetch user profile from Microsoft Graph API."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://graph.microsoft.com/v1.0/me",
            params={"$select": "id,displayName,mail,userPrincipalName,jobTitle,department,mobilePhone,officeLocation"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json()


async def get_microsoft_manager_profile(access_token: str) -> dict | None:
    """Fetch the signed-in user's manager from Microsoft Graph, or None if
    they have no manager set in Azure AD (a 404 from Graph)."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://graph.microsoft.com/v1.0/me/manager",
            params={"$select": "id,mail,userPrincipalName"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()


async def get_app_graph_token() -> str:
    """Get an app-only Graph token via client credentials (no signed-in user needed).
    Requires the Azure app registration to have admin-consented User.Read.All / Directory.Read.All."""
    app = get_msal_app()
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    token = result.get("access_token")
    if not token:
        raise ValueError(f"Unable to acquire Graph token: {result.get('error_description', result.get('error'))}")
    return token


async def list_azure_org_users() -> list[dict]:
    """Fetch every enabled user in the Azure AD tenant using an app-only Graph token."""
    token = await get_app_graph_token()
    users: list[dict] = []
    url = "https://graph.microsoft.com/v1.0/users"
    params = {
        "$select": "id,displayName,mail,userPrincipalName,jobTitle,department,mobilePhone,officeLocation,accountEnabled",
        "$filter": "accountEnabled eq true",
        "$top": 999,
    }
    async with httpx.AsyncClient() as client:
        while url:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
            resp.raise_for_status()
            data = resp.json()
            users.extend(data.get("value", []))
            url = data.get("@odata.nextLink")
            params = {}
        async def fetch_manager(user: dict) -> None:
            user_id = user.get("id")
            if not user_id:
                return
            manager_resp = await client.get(
                f"https://graph.microsoft.com/v1.0/users/{user_id}/manager",
                params={"$select": "id"},
                headers={"Authorization": f"Bearer {token}"},
            )
            if manager_resp.status_code == 404:
                user["manager"] = None
                return
            manager_resp.raise_for_status()
            user["manager"] = manager_resp.json()

        await asyncio.gather(*(fetch_manager(user) for user in users))
    return users


GLOBAL_ADMIN_ROLE_TEMPLATE_ID = "62e90394-69f5-4237-9190-012177145e10"


async def get_azure_admin_ids() -> set[str]:
    """Return the Azure object IDs of tenant Global Administrators."""
    token = await get_app_graph_token()
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://graph.microsoft.com/v1.0/directoryRoles/roleTemplateId={GLOBAL_ADMIN_ROLE_TEMPLATE_ID}/members",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            return set()
        return {m["id"] for m in resp.json().get("value", [])}
