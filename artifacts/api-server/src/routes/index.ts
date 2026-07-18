import { Router, type IRouter } from "express";
import healthRouter from "./health";
import relationsRouter from "./relations";
import whatsappRouter from "./whatsapp";
import memoryRouter from "./memory";
import agentRouter from "./agent";
import analysisRouter from "./analysis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(relationsRouter);
router.use(whatsappRouter);
router.use(memoryRouter);
router.use(agentRouter);
router.use(analysisRouter);

export default router;
