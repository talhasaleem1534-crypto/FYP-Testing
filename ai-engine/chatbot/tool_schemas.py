TOOLS = [
    {
        "name": "deploy_application",
        "description": "Trigger a deployment for a named application",
        "input_schema": {
            "type": "object",
            "properties": {
                "app_name": {
                    "type": "string",
                    "description": "The application's registered name (e.g., 'my-blog', 'api-service')"
                }
            },
            "required": ["app_name"]
        }
    },
    {
        "name": "scale_application",
        "description": "Change the number of running container replicas for an application",
        "input_schema": {
            "type": "object",
            "properties": {
                "app_name": {
                    "type": "string",
                    "description": "The application's registered name"
                },
                "replicas": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10,
                    "description": "Target number of replicas (between 1 and 10)"
                }
            },
            "required": ["app_name", "replicas"]
        }
    },
    {
        "name": "get_deployment_status",
        "description": "Check the current status and latest deployment details of an application",
        "input_schema": {
            "type": "object",
            "properties": {
                "app_name": {
                    "type": "string",
                    "description": "The application's registered name"
                }
            },
            "required": ["app_name"]
        }
    }
]
