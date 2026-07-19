import { Router, type IRouter } from "express";
import healthRouter from "./health";
import relationsRouter from "./relations";
import whatsappRouter from "./whatsapp";
import memoryRouter from "./memory";
import agentRouter from "./agent";
import analysisRouter from "./analysis";
import noContactRouter from "./no_contact";
import whatsappWebhookRouter from "./whatsapp_webhook";
import whatsappBaileysRouter from "./whatsapp_baileys";

const router: IRouter = Router();

router.use(healthRouter);
router.use(relationsRouter);
router.use(whatsappRouter);
router.use(memoryRouter);
router.use(agentRouter);
router.use(analysisRouter);
router.use(noContactRouter);
router.use(whatsappWebhookRouter);
router.use(whatsappBaileysRouter);

export default router;
