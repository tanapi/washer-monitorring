import json
import os
import urllib.request

REQUEST_METHOD = 'POST'
REQUEST_HEADERS = {
    'Content-Type': 'application/json',
    "User-Agent": "curl/7.64.1"
}

def lambda_handler(event, context):
    headers = event.get("headers", {})
    token = headers.get("authorization")
    if token != f"Bearer {os.environ['SECRET_TOKEN']}":
        return {
            "statusCode": 403,
            "body": "403 Forbidden"
        }
    
    request_body = json.loads(event.get('body', '{}'))
    url = request_body['webhook_url']
    message = request_body['content']

    params = {
        'content': message
    }
    data = json.dumps(params).encode('utf-8')
    request = urllib.request.Request(
        url,
        data,
        REQUEST_HEADERS,
        'POST'
    )
    with urllib.request.urlopen(request) as response:
        res_data = response.read().decode("utf-8")
        return res_data

    return "500 Internal Server Error"