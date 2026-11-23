import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8080);
const server = createApp().listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", msg: "orders-api listening", port }));
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

// Kubernetes sends SIGTERM before stopping the pod: finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
