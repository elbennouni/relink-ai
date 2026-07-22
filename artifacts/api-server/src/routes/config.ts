import { Router } from "express";

const router = Router();

/**
 * GET /api/config
 * Public endpoint — returns runtime config the mobile app needs before Clerk init.
 * The Clerk publishable key is auto-swapped by Replit from pk_test_ (dev) to pk_live_ (prod).
 */
router.get("/config", (_req, res) => {
  res.json({
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? "",
  });
});

export default router;
