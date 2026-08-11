"use client";

import { ChangeEvent, useMemo, useState } from "react";

type Provider = "openai" | "gemini";

const OPENAI_MODEL = "Luna";
const GEMINI_MODEL = "Gemini 3.5 Flash-Lite";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char] ?? char);
}

function markdownToHtml(markdown: string) {
  return markdown.split("\n").map((line) => {
    const safe = escapeHtml(line);
    if (line.startsWith("### ")) return `<h4>${safe.slice(4)}</h4>`;
    if (line.startsWith("## ")) return `<h3>${safe.slice(3)}</h3>`;
    if (line.startsWith("# ")) return `<h2>${safe.slice(2)}</h2>`;
    if (line.startsWith("- ") || line.startsWith("* ")) return `<li>${safe.slice(2)}</li>`;
    if (/^\d+\. /.test(line)) return `<li>${safe.replace(/^\d+\. /, "")}</li>`;
    if (/^\|.*\|$/.test(line)) return `<div class="result-table-line">${safe}</div>`;
    return line.trim() ? `<p>${safe}</p>` : '<div class="result-gap"></div>';
  }).join("").replace(/(<li>.*?<\/li>)+/g, (items) => `<ul>${items}</ul>`);
}

async function unzipDocumentXml(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder("utf-8");
  const target = "word/document.xml";
  for (let offset = 0; offset + 46 < bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (name !== target) continue;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(start, start + compressedSize);
    if (method === 0) return decoder.decode(compressed);
    if (method === 8 && "DecompressionStream" in window) {
      const stream = new DecompressionStream("deflate-raw");
      const decompressed = await new Response(new Blob([compressed]).stream().pipeThrough(stream)).arrayBuffer();
      return decoder.decode(decompressed);
    }
    throw new Error("이 브라우저에서는 압축된 DOCX를 읽을 수 없습니다.");
  }
  throw new Error("DOCX 본문을 찾지 못했습니다.");
}

async function extractDocxText(file: File) {
  const xml = await unzipDocumentXml(file);
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = Array.from(document.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "p"));
  return paragraphs.map((paragraph) => Array.from(paragraph.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "t")).map((node) => node.textContent ?? "").join("")).filter(Boolean).join("\n");
}

const prompt = `다음 회의 전사문을 사실에 충실한 한국어 회의록으로 변환해 주세요.

반드시 아래 Markdown 구조를 지키세요.
# 회의록
## 기본 정보
## 핵심 요약
## 주요 논의
## 결정사항
## 액션 아이템
| 업무 | 담당자 | 기한 | 상태/비고 |
## 미결 이슈 및 확인 필요
## 다음 회의

원문에 없는 참석자, 담당자, 기한, 결정, 수치는 만들지 말고 '미정' 또는 '[확인 필요]'로 표시하세요. 제안과 확정된 결정을 구분하세요.

회의 전사문:
`;

export default function Home() {
  const [provider, setProvider] = useState<Provider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [fileName, setFileName] = useState("");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const modelName = provider === "openai" ? OPENAI_MODEL : GEMINI_MODEL;
  const renderedResult = useMemo(() => result ? markdownToHtml(result) : "", [result]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(""); setResult(""); setFileName(file.name);
    try {
      if (!file.name.toLowerCase().endsWith(".docx")) throw new Error("DOCX 파일만 업로드할 수 있습니다.");
      setTranscript(await extractDocxText(file));
    } catch (err) {
      setTranscript(""); setError(err instanceof Error ? err.message : "파일을 읽지 못했습니다.");
    }
  }

  async function summarize() {
    if (!apiKey.trim()) return setError(`${provider === "openai" ? "OpenAI" : "Gemini"} API 키를 입력해 주세요.`);
    if (!transcript.trim()) return setError("먼저 회의 전사문 DOCX를 업로드해 주세요.");
    setBusy(true); setError(""); setResult("");
    try {
      if (provider === "openai") {
        const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` }, body: JSON.stringify({ model: "luna", temperature: 0.2, messages: [{ role: "system", content: "You are a precise meeting-minutes editor." }, { role: "user", content: `${prompt}\n${transcript}` }] }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "OpenAI API 요청에 실패했습니다.");
        setResult(data.choices?.[0]?.message?.content || "결과가 비어 있습니다.");
      } else {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey.trim())}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: `${prompt}\n${transcript}` }] }] },) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Gemini API 요청에 실패했습니다.");
        setResult(data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "결과가 비어 있습니다.");
      }
    } catch (err) { setError(err instanceof Error ? err.message : "요약 중 오류가 발생했습니다."); }
    finally { setBusy(false); }
  }

  function downloadMarkdown() {
    if (!result) return;
    const blob = new Blob([result], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "회의록.md"; link.click(); URL.revokeObjectURL(url);
  }

  return <main className="shell">
    <nav className="topbar"><div className="brand"><span className="brand-mark">M</span><span>MEETNOTE</span></div><span className="topbar-note">회의 전사 → 실행 가능한 회의록</span></nav>
    <section className="hero"><div className="eyebrow">AI MEETING MINUTES</div><h1>회의의 맥락은 남기고,<br /><em>다음 행동은 선명하게.</em></h1><p>DOCX 전사문을 올리고, 원하는 AI 엔진으로 실무형 회의록을 바로 정리하세요.</p></section>
    <section className="workspace">
      <div className="panel input-panel"><div className="panel-head"><span className="step">01</span><div><h2>전사문 업로드</h2><p>.docx 파일 하나로 시작하세요.</p></div></div><label className="dropzone"><input type="file" accept=".docx" onChange={handleFile} /><span className="upload-icon">↑</span><strong>{fileName || "회의 전사문을 끌어다 놓으세요"}</strong><small>{fileName ? `${transcript.length.toLocaleString()}자 추출됨` : "DOCX 파일 · 브라우저에서 안전하게 처리"}</small></label></div>
      <div className="panel settings-panel"><div className="panel-head"><span className="step">02</span><div><h2>요약 엔진 선택</h2><p>키는 저장하지 않고 이 브라우저에서만 사용합니다.</p></div></div><div className="provider-toggle"><button className={provider === "openai" ? "active" : ""} onClick={() => setProvider("openai")}>OpenAI</button><button className={provider === "gemini" ? "active" : ""} onClick={() => setProvider("gemini")}>Gemini</button></div><label className="field-label" htmlFor="model">기본 모델</label><div className="model-field"><span>{modelName}</span><span>⌄</span></div><label className="field-label" htmlFor="api-key">{provider === "openai" ? "OpenAI" : "Gemini"} API 키</label><input id="api-key" className="text-field" type="password" placeholder="API 키를 입력하세요" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" /></div>
      <div className="action-row"><button className="summarize-button" onClick={summarize} disabled={busy}>{busy ? "회의록을 정리하는 중..." : "회의록 생성하기  →"}</button>{error && <p className="error" role="alert">{error}</p>}</div>
    </section>
    <section className="result-section"><div className="result-head"><div><div className="eyebrow">OUTPUT</div><h2>요약된 회의록</h2></div><div className="result-actions"><span className="format-badge">MARKDOWN</span><button onClick={downloadMarkdown} disabled={!result}>↓ 다운로드</button></div></div><div className={`result-card ${result ? "has-result" : ""}`}>{result ? <div className="markdown-output" dangerouslySetInnerHTML={{ __html: renderedResult }} /> : <div className="empty-result"><span>✦</span><p>생성된 회의록이 이곳에 표시됩니다.</p><small>결정사항, 액션 아이템, 미결 이슈까지 한눈에 확인하세요.</small></div>}</div></section>
    <footer><span>MEETNOTE</span><span>개인 API 키는 저장되지 않습니다 · Vercel 배포 가능 구조</span></footer>
  </main>;
}
