import { defineApp } from "convex/server";
import brevo from "convex-brevo/convex.config";

const app = defineApp();
app.use(brevo);

export default app;
