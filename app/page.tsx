"use client";

import { ChangeEvent, DragEvent, useMemo, useState } from "react";

type Provider = "openai" | "gemini";

const PROVIDERS: Record<Provider, { label: string; model: string; modelId: string; accent: string }> = {
  openai: { label: "OpenAI", model: "Luna", modelId: "Luna", accent: "OpenAI" },
  gemini: {
    label: "Gemini",
    model: "Gemini 3.5 Flash-Lite",
    modelId: "gemini-3.5-flash-lite",
    accent: "Gemini",
  },
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

function inlineMarkdown(value: string) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
}

function MarkdownPreview({ content }: { content: string }) {
  const blocks = useMemo(() => {
    const lines = content.split(/\r?\n/);
    const output: Array<{ type: string; value?: string; items?: string[] }> = [];
    let bullets: string[] = [];
    const flushBullets = () => {
      if (bullets.length) {
        output.push({ type: "bullets", items: bullets });
        bullets = [];
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        flushBullets();
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        bullets.push(line.replace(/^[-*]\s+/, ""));
        continue;
      }
      flushBullets();
      if (line.startsWith("### ")) output.push({ type: "h3", value: line.slice(4) });
      else if (line.startsWith("## ")) output.push({ type: "h2", value: line.slice(3) });
      else if (line.startsWith("# ")) output.push({ type: "h1", value: line.slice(2) });
      else output.push({ type: "p", value: line });
    }
    flushBullets();
    return output;
  }, [content]);

  return (
    <div className="markdown-preview">
      {blocks.map((block, index) => {
        if (block.type === "bullets") {
          return (
            <ul key={index}>
              {block.items?.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: inlineMarkdown(item) }} />)}
            </ul>
          );
        }
        const Tag = block.type as "h1" | "h2" | "h3" | "p";
        return <Tag key={index} dangerouslySetInnerHTML={{ __html: inlineMarkdown(block.value ?? "") }} />;
      })}
    </div>
  );
}

async function inflateRaw(data: Uint8Array) {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  writer.write(data as unknown as BufferSource);
  writer.close();
  const response = new Response(stream.readable);
  return new Uint8Array(await response.arrayBuffer());
}

async function extractDocxText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new TextDecoder("utf-8");
  let offset = 0;
  let documentXml = "";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    if (name === "word/document.xml") {
      const inflated = method === 8 ? await inflateRaw(compressed) : compressed;
      documentXml = decoder.decode(inflated);
      break;
    }
    offset = dataStart + compressedSize;
  }

  if (!documentXml) throw new Error("DOCX 본문을 읽지 못했습니다.");
  return documentXml
    .replace(/<w:tab\s*\/?>(.*?)<\/w:tab>/g, "\t")
    .replace(/<w:br\s*\/?>(.*?)<\/w:br>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function Home() {
  const [provider, setProvider] = useState<Provider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("파일을 올리면 바로 시작할 수 있어요.");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const active = PROVIDERS[provider];

  const selectFile = (nextFile: File | undefined) => {
    if (!nextFile) return;
    if (!nextFile.name.toLowerCase().endsWith(".docx")) {
      setError("DOCX 파일만 업로드할 수 있습니다.");
      return;
    }
    setFile(nextFile);
    setResult("");
    setError("");
    setStatus("파일을 확인했습니다. 요약 엔진과 키를 입력해 주세요.");
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => selectFile(event.target.files?.[0]);
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  };

  const summarize = async () => {
    if (!file) return setError("먼저 회의록 전사문 DOCX를 올려 주세요.");
    if (!apiKey.trim()) return setError(`${active.label} API 키를 입력해 주세요.`);
    setLoading(true);
    setError("");
    setResult("");
    setStatus("전사문을 읽고 회의록으로 정리하는 중입니다...");
    try {
      const transcript = await extractDocxText(file);
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model: active.modelId, apiKey, transcript }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "요약 요청에 실패했습니다.");
      setResult(payload.markdown);
      setStatus("요약이 완료되었습니다. 아래 결과를 검토해 주세요.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "요약 중 오류가 발생했습니다.");
      setStatus("요약을 완료하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="site-shell">
      <nav className="topbar">
        <div className="brand-lockup"><span className="brand-mark">↗</span><span>minutes<span className="brand-dot">.</span>ai</span></div>
        <span className="topbar-note">TRANSCRIPT TO MINUTES</span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">회의의 맥락은 살리고, 결정은 선명하게</p>
          <h1>전사문을<br /><em>실행 가능한 회의록</em>으로.</h1>
          <p className="hero-description">긴 대화를 읽는 데 쓰던 시간을 줄이고, 결정사항과 다음 액션에 집중하세요. DOCX 하나면 충분합니다.</p>
          <div className="trust-line"><span className="trust-icon">✦</span><span>키는 저장하지 않고, 요청 시에만 사용합니다.</span></div>
        </div>

        <div className="workspace-card">
          <div className="card-header"><div><span className="section-kicker">01 / INPUT</span><h2>전사문 업로드</h2></div><span className="file-type">.DOCX</span></div>
          <label className={`dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
            <input type="file" accept=".docx" onChange={handleFileChange} />
            <span className="upload-orb">↥</span>
            {file ? <><strong>{file.name}</strong><span>파일이 준비되었습니다. 다른 파일을 선택하려면 클릭하세요.</span></> : <><strong>DOCX 파일을 끌어다 놓으세요</strong><span>또는 클릭해서 파일 선택</span></>}
          </label>

          <div className="engine-section"><div className="section-kicker">02 / ENGINE</div><div className="provider-toggle" role="group" aria-label="요약 엔진 선택">{(Object.keys(PROVIDERS) as Provider[]).map((key) => <button className={provider === key ? "active" : ""} key={key} onClick={() => setProvider(key)}>{PROVIDERS[key].label}</button>)}</div><div className="model-row"><span>기본 모델</span><span className="model-badge"><span className="status-dot" />{active.model}</span></div></div>

          <div className="key-section"><label className="section-kicker" htmlFor="api-key">03 / API KEY</label><div className="key-input"><input id="api-key" type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={`${active.label} API 키 입력`} autoComplete="off" /><button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "키 숨기기" : "키 보기"}>{showKey ? "숨김" : "보기"}</button></div><p className="key-note">브라우저에 저장하지 않습니다.</p></div>

          <button className="primary-action" onClick={summarize} disabled={loading}>{loading ? <><span className="spinner" /> 정리하는 중...</> : <>회의록 만들기 <span>→</span></>}</button>
          <p className="status-line"><span className={loading ? "status-dot pulse" : "status-dot"} />{status}</p>
          {error && <p className="error-message">{error}</p>}
        </div>
      </section>

      <section className={`result-section ${result ? "has-result" : ""}`}>
        <div className="result-heading"><div><span className="section-kicker">04 / OUTPUT</span><h2>정리된 회의록</h2></div>{result && <span className="result-ready">● READY TO REVIEW</span>}</div>
        {result ? <div className="result-card"><MarkdownPreview content={result} /></div> : <div className="empty-result"><span>✦</span><p>요약 결과가 여기에 표시됩니다.</p><small>전사문을 업로드하고 엔진을 선택해 시작하세요.</small></div>}
      </section>

      <footer><span>minutes.ai</span><span>Factual summaries for teams that move.</span><span>© 2026</span></footer>
    </main>
  );
}
