import json
import os
import urllib.request

REQUEST_METHOD = 'POST'
REQUEST_HEADERS = {
    'Content-Type': 'application/json',
    "User-Agent": "curl/7.64.1" # DiscordのWebhookはUAの偽装が必要
}

def lambda_handler(event, context):
    headers = event.get("headers", {})
    token = headers.get("authorization")
    
    try:
        secret_token = os.environ['SECRET_TOKEN']
    except KeyError:
        return {
            "statusCode": 500,
            "body": "Server configuration error"
        }
    
    if token != f"Bearer {secret_token}":
        return {
            "statusCode": 403,
            "body": "403 Forbidden"
        }
    
    try:
        request_body = json.loads(event.get('body', '{}'))
        url = request_body['webhook_url']
        message = request_body['content']
    except (json.JSONDecodeError, KeyError) as e:
        return {
            "statusCode": 400,
            "body": f"Bad Request: {str(e)}"
        }
    
    params = {
        'content': message
    }
    data = json.dumps(params).encode('utf-8')
    try:
        request = urllib.request.Request(
            url,
            data,
            REQUEST_HEADERS,
            method='POST'
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            res_data = response.read().decode("utf-8")
            return {
                "statusCode": 200,
                "body": res_data
            }
    except urllib.error.HTTPError as e:
        return {
            "statusCode": e.code,
            "body": f"Webhook error: {e.reason}"
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "body": f"Internal error: {str(e)}"
        }