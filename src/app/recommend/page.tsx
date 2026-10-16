import { getPublicStatus } from "../../server/status";
import { RecommendationWorkspace } from "../../components/recommendation-workspace";
export const dynamic = "force-dynamic";
export default function RecommendPage() { return <RecommendationWorkspace status={getPublicStatus()} />; }
