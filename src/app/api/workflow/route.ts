import { NextRequest, NextResponse } from "next/server";
import { parseConfig } from "../../../server/config";
import { getWorkflow, assertWorkflowOrigin } from "../../../server/workflow-runtime";
import { WorkflowError } from "../../../server/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
  try {
    assertWorkflowOrigin(request, parseConfig(process.env).mode);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new WorkflowError("请求格式错误。", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new WorkflowError("请求内容为空。");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); throw new WorkflowError("请求内容过大。", 413); } chunks.push(value); }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new WorkflowError("请求内容不是有效 JSON。"); }
    const session = await getWorkflow(request.cookies.get("mctiming-session")?.value);
    const view = await session.workflow.dispatch(input);
    const response = NextResponse.json(view, { headers });
    response.cookies.set("mctiming-session", session.id, { httpOnly: true, sameSite: "strict", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 1800 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof WorkflowError ? error.message : "本地服务暂时不可用，请检查配置后重试。" }, { status: error instanceof WorkflowError ? error.status : 503, headers });
  }
}
