import { Router, type IRouter } from "express";
import healthRouter from "./health";
import relationsRouter from "./relations";
import whatsappRouter from "./whatsapp";
import memoryRouter from "./memory";
import agentRouter from "./agent";
import analysisRouter from "./analysis";
import noContactRouter from "./no_contact";
import { webhookPublicRouter, whatsappConfigRouter } from "./whatsapp_webhook";
import whatsappBaileysRouter from "./whatsapp_baileys";
import transcribeRouter from "./transcribe";
import suggestRepliesRouter from "./suggest_replies";
import analyzeIncomingRouter from "./analyze_incoming";
import pushTokensRouter from "./push_tokens";
import powerBalanceRouter from "./power_balance";
import addMessageRouter from "./add_message";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRelationOwnership } from "../middlewares/requireRelationOwnership";

const router: IRouter = Router();

// ── Public routes (no Clerk session required) ─────────────────────────────────
router.use(healthRouter);
// Only the Meta webhook challenge + inbound message endpoints are public.
// The /relations/:id/whatsapp/config endpoints are in the private section below.
router.use(webhookPublicRouter);

// ── All routes below require a valid Clerk session ───────────────────────────
router.use(requireAuth);

// For any relation-specific path (/relations/:id/*), verify the user owns the relation.
// This middleware auto-claims legacy null-userId relations on first access.
router.use("/relations/:id", requireRelationOwnership);

router.use(relationsRouter);
router.use(whatsappRouter);
router.use(whatsappConfigRouter);
router.use(memoryRouter);
router.use(agentRouter);
router.use(analysisRouter);
router.use(noContactRouter);
router.use(whatsappBaileysRouter);
router.use(transcribeRouter);
router.use(suggestRepliesRouter);
router.use(analyzeIncomingRouter);
router.use(pushTokensRouter);
router.use(powerBalanceRouter);
router.use(addMessageRouter);

export default router;
