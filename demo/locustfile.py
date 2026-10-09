from locust import HttpUser, task, between

class PlatformUser(HttpUser):
    wait_time = between(0.1, 0.5)

    @task(3)
    def visit_index(self):
        self.client.get("/", headers={"Host": "blog.example.com"})

    @task(1)
    def visit_api(self):
        self.client.get("/api/health", headers={"Host": "blog.example.com"})
