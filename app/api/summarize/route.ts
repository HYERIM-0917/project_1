import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `당신은 한국어 회의록 편집자입니다. 제공된 회의 전사문만 근거로 사실 기반 회의록을 작성하세요. 추론으로 사실을 만들지 말고 불명확한 정보는 [확인 필요]로 표시하세요. 다음 Markdown 구조를 지키세요: # 회의록 제목, ## 핵심 요약, ## 주요 논의사항, ## 결정사항 및 의결 결과, ## 후속조치, ## 확인 필요사항. 결정·조건·담당자·기한·금액·수치는 원문에 명시된 내용만 반영하세요. 전체 발언록을 복사하지 말고 실행에 필요한 내용 중심으로 정리하세요.`;

function extractOpenAIText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  return (payload?.output ?? [])
    .flatMap((item: any) => item.content ?? [])
    .map((item: any) => item.text ?? "")
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const provider = body?.provider === "gemini" ? "gemini" : "openai";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
    const model = typeof body?.model === "string" ? body.model : provider === "gemini" ? "gemini-3.5-flash-lite" : "Luna";
    if (!apiKey || !transcript) return NextResponse.json({ error: "API 키와 전사문이 필요합니다." }, { status: 400 });

    if (provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, store: false, input: `${SYSTEM_PROMPT}\n\n[전사문]\n${transcript}` }),
      });
      const payload = await response.json();
      if (!response.ok) return NextResponse.json({ error: payload?.error?.message || "OpenAI API 요청이 실패했습니다." }, { status: response.status });
      return NextResponse.json({ markdown: extractOpenAIText(payload) || "요약 결과가 비어 있습니다." });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\n[전사문]\n${transcript}` }] }] }),
    });
    const payload = await response.json();
    if (!response.ok) return NextResponse.json({ error: payload?.error?.message || "Gemini API 요청이 실패했습니다." }, { status: response.status });
    const markdown = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("\n");
    return NextResponse.json({ markdown: markdown || "요약 결과가 비어 있습니다." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "요약 요청을 처리하지 못했습니다." }, { status: 500 });
  }
}
