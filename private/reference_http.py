import base64
import json
import sys
import urllib.request
import urllib.error
from urllib.parse import urlsplit

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

try:
    data = json.load(sys.stdin)
    url = urlsplit(data["url"])
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise ValueError("Invalid HTTPS destination")

    request = urllib.request.Request(
        data["url"],
        data=base64.b64decode(data["body"], validate=True),
        headers=data["headers"],
        method=data["method"]
    )
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=45) as response:
            result = {
                "status": response.status,
                "body": base64.b64encode(response.read()).decode()
            }
    except urllib.error.HTTPError as error:
        result = {"status": error.code, "body": ""}
    print(json.dumps(result))
except Exception:
    print(json.dumps({"status": 0, "body": ""}))
    sys.exit(1)
