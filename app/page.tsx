"use client";
import { useState, useEffect } from 'react';

const signalVendors = [
  { id: "clay", name: "Clay", logo: "https://logo.clearbit.com/clay.com" },
  { id: "apollo", name: "Apollo", logo: "https://logo.clearbit.com/apollo.io" },
  { id: "zoominfo", name: "ZoomInfo", logo: "https://logo.clearbit.com/zoominfo.com" },
  { id: "usergems", name: "UserGems", logo: "https://logo.clearbit.com/usergems.com" },
  { id: "warmly", name: "Warmly", logo: "https://logo.clearbit.com/warmly.ai" },
  { id: "commonroom", name: "Common Room", logo: "https://logo.clearbit.com/commonroom.io" }
];

const signalTypes = [
  { id: "job_changes", label: "Job Changes", desc: "Contact role changes" },
  { id: "funding", label: "Funding Events", desc: "Fundraising news" },
  { id: "tech_installs", label: "Tech Stack", desc: "Technology adoption" },
  { id: "intent_data", label: "Intent Data", desc: "Research behavior" },
  { id: "website_visitors", label: "Website Visitors", desc: "De-anonymized" }
];

const steps = ["intro", "select-product", "basic", "research-company", "research-icp", "research-competitive", "research-content", "signals", "alignment", "generating", "results"];
export default function Home() {
  const [currentStep, setCurrentStep] = useState(0);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [role, setRole] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [crm, setCrm] = useState("");
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);
  const [alignment, setAlignment] = useState<{gtm?: string}>({});
  const [research, setResearch] = useState({
    company: { initial: "", feedback: "", refined: "", loading: false },
    icp: { initial: "", feedback: "", refined: "", loading: false },
    competitive: { initial: "", feedback: "", refined: "", loading: false },
    content: { initial: "", feedback: "", refined: "", loading: false }
  });
  const [reportData, setReportData] = useState<{narrative: string; icp: string; content: string; competitive: string} | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [products, setProducts] = useState<string[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [productsLoading, setProductsLoading] = useState(false);

  const cleanResponse = (text: string) => {
    if (!text) return "";
    let cleaned = text
      .replace(/^.*?(?:I'll|I will|Let me|Based on|Here's|Here is|After|Now I'll).*?(?:research|search|analyze|create|provide|analysis).*$/gim, "")
      .replace(/^.*?(?:web search|my search|searching|searched).*$/gim, "")
      .replace(/^.*?ICP.*?(?:section|profile|for).*?:?\s*$/gim, "")
      .replace(/^#{1,4}\s*/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/^\s*[-*]\s+/gm, "")
      .trim();
    cleaned = cleaned.replace(/([a-z,])\s*\n+(?![A-Z]{2,})/g, "$1 ");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
    return cleaned;
  };
  
  const cleanCompetitiveResponse = (text: string) => {
    if (!text) return "";
    let cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    cleaned = cleaned
      .replace(/^.*?(?:I'll|I will|Let me|Based on|Here's|Here is|After|Now I'll).*?(?:research|search|analyze|create|provide|analysis).*$/gim, "")
      .replace(/^.*?(?:web search|my search|searching|searched).*$/gim, "")
      .replace(/^.*?ICP.*?(?:section|profile|for).*?:?\s*$/gim, "")
      .replace(/^#{1,4}\s*/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .trim();
    const lines = cleaned.split("\n");
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;
      if (/^\|[\s\-:]+\|/.test(line) || /^[\-:|\s]+$/.test(line)) continue;
      if (line.startsWith("|") && line.endsWith("|")) {
        line = line.slice(1, -1).trim();
      } else if (line.startsWith("|")) {
        line = line.slice(1).trim();
      } else if (line.endsWith("|")) {
        line = line.slice(0, -1).trim();
      }
      line = line.replace(/^[-*•]\s+/, "");
      if (line.includes("|")) {
        line = line.split("|").map(p => p.trim()).join(" | ");
        result.push(line);
      } else if (/^[A-Z][A-Z\s\-:]+$/.test(line) && line.length >= 2 && line.length < 60) {
        result.push(line);
      } else {
        const prevLine = result[result.length - 1];
        if (prevLine && !prevLine.includes("|") && !/^[A-Z][A-Z\s\-:]+$/.test(prevLine)) {
          result[result.length - 1] = prevLine + " " + line;
        } else {
          result.push(line);
        }
      }
    }
    return result.join("\n");
  };

  const callClaude = async (prompt: string) => {
    try {
      const searchPrompt = `Use your web_search tool to research this request. Search the web first, then provide your analysis.\n\n${prompt}`;
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: searchPrompt }]
        })
      });
      if (!response.ok) {
        return "API error: " + response.status + ". Please try again.";
      }
      const data = await response.json();
      if (data.error) {
        return "Error: " + (data.error.message || "Unknown error occurred");
      }
      const textContent = (data.content || [])
        .filter((block: {type: string}) => block.type === "text")
        .map((block: {text: string}) => block.text)
        .join("\n");
      return textContent || "No response generated. Please try again.";
    } catch (error) {
      return "Connection error: " + ((error as Error).message || "Please check your internet and try again.");
    }
  };

const getCompanyPrompt = () => `Search the web for "${domain}" and specifically their "${selectedProduct}" product/offering.
After researching, analyze ${domain}'s "${selectedProduct}" for a GTM diagnostic. Write directly TO the reader using "you/your".
CRITICAL: Start your response with the first header "WHAT YOU DO" - no preamble.

Use these exact ALL CAPS headers:

WHAT YOU DO
Describe in 2-3 sentences what "${selectedProduct}" does, who it serves, and its core value proposition.
THE PROBLEM YOU SOLVE
What specific pain point or challenge do you address for your customers?

YOUR DIFFERENTIATION
What makes you unique compared to alternatives?

RULES:
- NO PREAMBLE - start directly with WHAT YOU DO header
- Write TO the reader using "you/your"
- No markdown formatting`;

  const getICPPrompt = () => {
    const ctx = research.company.refined || research.company.initial || "";
    const contextStr = cleanResponse(ctx).substring(0, 400);
return `Search the web for "${domain}" and their "${selectedProduct}" to understand the business and market.
Create the ICP section for ${domain}'s "${selectedProduct}". Write directly TO the reader using "you/your".
${contextStr ? `Company Context: ${contextStr}` : ""}

CRITICAL: Start with "YOUR IDEAL BUYERS" header - no preamble.

Use these exact ALL CAPS headers:

YOUR IDEAL BUYERS
Describe the companies you should target: industry, size, growth stage.

PERSONAS AND JOBS TO BE DONE
List 3-4 key personas. For each:
PERSONA: [Title]
GOAL: [What outcome they want]
JTBD: When [situation], I want to [action], so I can [outcome].

SIGNAL SYSTEM
Create exactly 6 alpha signals. Each row on its OWN LINE with pipe separators:

Signal Name | Description | Motion Triggered

RULES:
- NO PREAMBLE
- Each signal on its OWN LINE
- 3 columns separated by |
- 6 signals total`;
  };

const getCompetitivePrompt = () => `Search the web for "${domain}" "${selectedProduct}" competitors.

CRITICAL: Start with "COMPETITIVE LANDSCAPE" header - no preamble.

Use this EXACT structure:

COMPETITIVE LANDSCAPE
[2-3 sentences about the market]

COMPARISON TABLE
Competitor1 | Their Strength | Their Weakness | Where You Win
Competitor2 | Their Strength | Their Weakness | Where You Win
Competitor3 | Their Strength | Their Weakness | Where You Win
Competitor4 | Their Strength | Their Weakness | Where You Win
Competitor5 | Their Strength | Their Weakness | Where You Win

YOUR COMPETITIVE MOAT
[What makes ${domain}'s "${selectedProduct}" hard to compete with]

RULES:
- NO PREAMBLE
- Competitor names 1-3 words only
- Each competitor row MUST be on its own line
- Each row has exactly 4 pipe-separated values
- Put a blank line between each section
- CRITICAL: Each competitor must be on a SEPARATE LINE with a line break after it`;

  const getContentPrompt = () => {
    const ctx = research.icp.refined || research.icp.initial;
return `Search the web for "${domain}" "${selectedProduct}" content - blog, LinkedIn, podcasts.
Analyze content strategy. Write TO the reader using "you/your".

CRITICAL: Start with "CONTENT OVERVIEW" header - no preamble.

CONTENT OVERVIEW
What content you produce.

ICP ALIGNMENT
Does your content address what buyers care about?

LINKEDIN PRESENCE
How visible are you on LinkedIn?

CONTENT GRADE: [A/B/C/D/F]
One sentence explanation.

HOW TO IMPROVE
3-4 specific recommendations.

RULES:
- NO PREAMBLE
- Write TO reader using "you/your"`;
  };

  const runResearchPhase = async (phase: string) => {
    const prompts: {[key: string]: () => string} = { company: getCompanyPrompt, icp: getICPPrompt, competitive: getCompetitivePrompt, content: getContentPrompt };
    setResearch(prev => ({ ...prev, [phase]: { ...prev[phase as keyof typeof prev], loading: true } }));
    try {
      const result = await callClaude(prompts[phase]());
      setResearch(prev => ({ ...prev, [phase]: { ...prev[phase as keyof typeof prev], initial: result, loading: false } }));
    } catch {
      setResearch(prev => ({ ...prev, [phase]: { ...prev[phase as keyof typeof prev], initial: "Error loading data.", loading: false } }));
    }
  };

  const parseIntoSections = (text: string) => {
    if (!text) return [{ title: "", content: ["No data"] }];
    const sections: {title: string; content: string[]}[] = [];
    const lines = text.split("\n");
    let current = { title: "", content: [] as string[] };
    for (let i = 0; i < lines.length && i < 200; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      const isHeader = /^[A-Z][A-Z\s\-:]+$/.test(trimmed) && trimmed.length >= 2 && trimmed.length < 60;
      if (isHeader) {
        if (current.title || current.content.length > 0) sections.push(current);
        current = { title: trimmed.replace(/:$/, ""), content: [] };
      } else {
        current.content.push(trimmed);
      }
    }
    if (current.title || current.content.length > 0) sections.push(current);
    return sections.length > 0 ? sections : [{ title: "", content: ["No data"] }];
  };

  const formatResearchOutput = (text: string, type: string) => {
    const cleaned = (type === "competitive" || type === "icp") ? cleanCompetitiveResponse(text) : cleanResponse(text);
    const sections = parseIntoSections(cleaned);
    const filteredSections = sections.filter(sec => sec.title !== "WHY" && sec.title !== "WHY IT MATTERS");
    
    return filteredSections.map((sec, i) => {
      const hasCompetitorTable = type === "competitive" && sec.content.some(line => (line.match(/\|/g) || []).length >= 2);
      const titleLooksLikeSignal = sec.title && (sec.title.includes("SIGNAL") || sec.title.includes("ALPHA") || sec.title.includes("BUYING"));
      const contentHasSignalTable = sec.content.some(line => { const pc = (line.match(/\|/g) || []).length; return pc >= 1 && pc <= 3; });
      const hasSignalTable = titleLooksLikeSignal && contentHasSignalTable;
      const isPersonaSection = sec.title && (sec.title.includes("PERSONA") || sec.title.includes("JOBS"));
      
      return (
        <div key={i} className="mb-6 pb-5 border-b border-white/10 last:border-0">
          {sec.title && <div className="text-xs font-semibold text-rose-500 uppercase tracking-wider mb-3">{sec.title}</div>}
          <div className="text-white/90 leading-relaxed">
            {hasSignalTable && (
              <>
                <div className="grid grid-cols-3 gap-3 py-3 border-b-2 border-green-500/50 text-xs font-bold uppercase tracking-wide mb-2">
                  <span className="text-green-400">Signal</span>
                  <span className="text-white/70">Description</span>
                  <span className="text-blue-400">Motion Triggered</span>
                </div>
                {sec.content.map((line, j) => {
                  if (!line.includes("|")) return null;
                  const parts = line.split("|").map(p => p.trim());
                  if (parts.length < 2) return null;
                  return (
                    <div key={j} className="grid grid-cols-3 gap-3 py-3 border-b border-white/10 text-sm items-start">
                      <span className="font-semibold text-green-400">{parts[0]}</span>
                      <span className="text-white/70">{parts[1] || "—"}</span>
                      <span className="text-blue-400">{parts[2] || "—"}</span>
                    </div>
                  );
                })}
              </>
            )}
            {hasCompetitorTable && (
              <>
                <div className="grid grid-cols-4 gap-3 py-3 border-b-2 border-rose-500/50 text-xs font-bold uppercase tracking-wide mb-2">
                  <span className="text-white">Competitor</span>
                  <span className="text-green-400">Their Strength</span>
                  <span className="text-orange-400">Their Weakness</span>
                  <span className="text-rose-400">Where You Win</span>
                </div>
                {sec.content.map((line, j) => {
                  if (!line.includes("|")) return null;
                  const parts = line.split("|").map(p => p.trim()).filter(p => p.length > 0);
                  if (parts.length < 2) return null;
                  let competitorName = parts[0];
                  if (competitorName.length > 25) competitorName = competitorName.split(" ").slice(-2).join(" ");
                  return (
                    <div key={j} className="grid grid-cols-4 gap-3 py-3 border-b border-white/10 text-sm items-start">
                      <span className="font-semibold text-white">{competitorName}</span>
                      <span className="text-green-400">{parts[1] || "—"}</span>
                      <span className="text-orange-400">{parts[2] || "—"}</span>
                      <span className="text-rose-400 font-medium">{parts[3] || "—"}</span>
                    </div>
                  );
                })}
              </>
            )}
            {isPersonaSection && (
              <div className="space-y-4">
                {parsePersonas(sec.content).map((persona, j) => (
                  <div key={j} className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/30 rounded-xl p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center text-lg">👤</div>
                      <div>
                        <div className="font-semibold text-purple-400">{persona.title}</div>
                        {persona.goal && <div className="text-sm text-white/60">{persona.goal}</div>}
                      </div>
                    </div>
                    {persona.jtbd && (
                      <div className="bg-black/20 rounded-lg p-4 mt-3">
                        <div className="text-xs text-purple-400 uppercase tracking-wide mb-2">Job to Be Done</div>
                        <p className="text-sm italic text-white/80">&quot;{persona.jtbd}&quot;</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!hasCompetitorTable && !hasSignalTable && !isPersonaSection && (
              sec.content.map((line, j) => <p key={j} className="mb-3 last:mb-0">{line}</p>)
            )}
          </div>
        </div>
      );
    });
  };
  
  const parsePersonas = (content: string[]) => {
    const personas: {title: string; goal: string; jtbd: string}[] = [];
    const fullText = content.join(" ");
    
    const chunks = fullText.split(/(?=PERSONA:)/i).filter(chunk => chunk.trim() && chunk.toLowerCase().includes('persona:'));
    
    chunks.forEach(chunk => {
      const persona = { title: "", goal: "", jtbd: "" };
      
      const titleMatch = chunk.match(/PERSONA:\s*([^]*?)(?=\s*GOAL:|$)/i);
      if (titleMatch) {
        persona.title = titleMatch[1].trim().replace(/\s+/g, ' ');
      }
      
      const goalMatch = chunk.match(/GOAL:\s*([^]*?)(?=\s*JTBD:|$)/i);
      if (goalMatch) {
        persona.goal = goalMatch[1].trim().replace(/\s+/g, ' ');
      }
      
      const jtbdMatch = chunk.match(/JTBD:\s*([^]*?)$/i);
      if (jtbdMatch) {
        let jtbd = jtbdMatch[1].trim();
        jtbd = jtbd.split(/PERSONA:/i)[0].trim();
        persona.jtbd = jtbd.replace(/\s+/g, ' ');
      }
      
      if (persona.title && persona.title.length > 2) {
        personas.push(persona);
      }
    });
    
    if (personas.length === 0) {
      return [{ title: "Key Buyer Persona", goal: content.join(" ").substring(0, 200), jtbd: "" }];
    }
    
    return personas;
  };

  const nextStep = () => { if (currentStep < steps.length - 1) setCurrentStep(currentStep + 1); };
  const prevStep = () => { if (currentStep > 0) setCurrentStep(currentStep - 1); };

  const startDiagnostic = async () => {
    if (!websiteUrl) { alert("Please enter URL"); return; }
    const d = websiteUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    setDomain(d);
    setProductsLoading(true);
    nextStep();
    
    // Fetch products/offerings
    try {
      const result = await callClaude(`Search the web for "${d}" and identify their products, solutions, or service offerings.

Return ONLY a simple numbered list of their distinct products/offerings. For example:
1. Product Name A
2. Product Name B
3. Service Offering C

If they only have ONE main product/solution, just return that one item.
If it's a service company with no distinct products, list their main service categories.

RULES:
- Maximum 8 items
- Just the product/service names, no descriptions
- No preamble, just the numbered list`);
      
      // Parse the numbered list
      const parsed = result.split('\n')
.map((line: string) => line.replace(/^\d+[\.\)]\s*/, '').trim())
.filter((line: string) => line.length > 0 && line.length < 100);
      
      setProducts(parsed.length > 0 ? parsed : [d]);
    } catch (e) {
      setProducts([d]);
    }
    setProductsLoading(false);
  };

  const saveBasicAndNext = async () => {
    if (!email) { alert("Please enter email"); return; }
    
    // Send contact data to HubSpot
    try {
      const response = await fetch("/api/hubspot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectType: "contacts",
          searchProperty: "email",
          searchValue: email,
          properties: {
            email,
            company: companyName,
            jobtitle: role,
            website: domain,
          }
        })
      });
      const data = await response.json();
      if (data.id) {
        setContactId(data.id);
      }
    } catch (e) {
      console.error("HubSpot contact sync error:", e);
    }
    
    nextStep();
  };

  useEffect(() => {
    const step = steps[currentStep];
    const phases: {[key: string]: string} = { "research-company": "company", "research-icp": "icp", "research-competitive": "competitive", "research-content": "content" };
    const currentPhase = phases[step];
    if (currentPhase) {
      const phaseData = research[currentPhase as keyof typeof research];
      if (!phaseData.initial && !phaseData.loading) runResearchPhase(currentPhase);
    }
    if (step === "basic" && domain) {
      const companyData = research.company;
      if (!companyData.initial && !companyData.loading) runResearchPhase("company");
    }
    if (step === "generating" && !reportData) generateReport();
  }, [currentStep, domain]);

  const generateReport = async () => {
    const getR = (k: string) => cleanResponse(research[k as keyof typeof research].refined || research[k as keyof typeof research].initial || "");
    const getCompetitive = () => research.competitive.refined || research.competitive.initial || "";
    
    const narrative = await callClaude(`You're a straight-talking GTM advisor. Write an executive summary for ${companyName || domain}'s "${selectedProduct}".

Context: ${getR("company").substring(0, 300)}
ICP: ${getR("icp").substring(0, 200)}
GTM maturity: ${alignment.gtm || "unknown"}

YOUR WRITING STYLE:
- Short, punchy sentences. Some just fragments.
- Use periods for emphasis. Like. This.
- No fluff. No "leverage" or "optimize" or "drive growth"
- Sound like a smart friend giving real talk, not a consultant
- Be specific to THEIR business, not generic advice
- Max 150 words total

Write 3 SHORT paragraphs:
1. What's working (be specific)
2. The gap (what's broken or missing)
3. The unlock (one clear priority)

NO PREAMBLE. Start with paragraph 1.`);

    const finalReportData = { 
      narrative, 
      icp: research.icp.refined || research.icp.initial || "", 
      content: getR("content"), 
      competitive: getCompetitive() 
    };
    
    setReportData(finalReportData);
    
    // Extract content grade (letter only)
    const contentText = getR("content");
    const gradeMatch = contentText.match(/CONTENT GRADE:\s*([A-F])/i);
    const contentGrade = gradeMatch ? gradeMatch[1].toUpperCase() : "";
    
   // Send analysis data to HubSpot Company
    try {
      await fetch("/api/hubspot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectType: "companies",
          searchProperty: "domain",
          searchValue: domain,
          properties: {
            domain,
            name: companyName || domain,
            gtm_company_analysis: getR("company").substring(0, 65000),
            gtm_icp_summary: getR("icp").substring(0, 65000),
            gtm_competitive_landscape: cleanCompetitiveResponse(getCompetitive()).substring(0, 65000),
            gtm_content_grade: contentGrade,
            gtm_content_analysis: contentText.substring(0, 65000),
            gtm_narrative: cleanResponse(narrative).substring(0, 65000),
            gtm_diagnostic_date: new Date().toISOString().split('T')[0]
          },
          associateWith: contactId ? { type: "contacts", id: contactId } : undefined
        })
      });
    } catch (e) {
      console.error("HubSpot company sync error:", e);
    }
    
    setCurrentStep(steps.indexOf("results"));
  };

  const renderStepIndicator = () => (
    <div className="flex justify-center gap-1.5 mb-7">
      {steps.map((_, i) => (
        <div key={i} className={`w-2.5 h-2.5 rounded-full transition-all ${i < currentStep ? "bg-green-500" : i === currentStep ? "bg-rose-500 scale-125" : "bg-white/15"}`} />
      ))}
    </div>
  );

  const renderIntro = () => (
    <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm p-11 text-center">
      <div className="text-5xl mb-6">🔬</div>
      <h2 className="font-bold text-2xl mb-3">Get Your Custom GTM Analysis</h2>
      <p className="text-white/60 mb-8 max-w-md mx-auto">Enter your website for AI-powered analysis of your company, customers, and competitors.</p>
      <div className="max-w-sm mx-auto">
        <input type="url" placeholder="https://yourcompany.com" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-4 text-white text-center mb-4 outline-none focus:border-rose-500" />
        <button onClick={startDiagnostic} className="w-full bg-gradient-to-r from-rose-500 to-rose-600 text-white py-4 px-8 rounded-lg font-semibold hover:shadow-lg hover:shadow-rose-500/30 transition-all">Start Analysis →</button>
      </div>
      <p className="mt-6 text-sm text-white/40">5-7 minutes • AI research • PDF report</p>
    </div>
  );
  const renderSelectProduct = () => {
    if (productsLoading) {
      return (
        <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm p-11">
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-white/10 border-t-rose-500 rounded-full animate-spin mx-auto mb-5" />
            <h3 className="font-semibold text-xl mb-2">Analyzing {domain}</h3>
            <p className="text-white/60">Identifying products and offerings...</p>
          </div>
        </div>
      );
    }
    
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm p-11">
        <h2 className="font-bold text-2xl mb-3">Select Your Focus</h2>
        <p className="text-white/60 mb-6">Which product or offering should we analyze? This helps us give you specific, actionable insights.</p>
        <div className="space-y-3">
          {products.map((product, i) => (
            <div
              key={i}
              onClick={() => setSelectedProduct(product)}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedProduct === product ? "border-rose-500 bg-rose-500/10" : "border-white/15 bg-white/5 hover:border-rose-500/40"}`}
            >
              <div className="font-semibold">{product}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-3 mt-7">
          <button onClick={prevStep} className="bg-white/5 border border-white/15 text-white py-4 px-8 rounded-lg font-medium hover:bg-white/10 transition-all">← Back</button>
          <button 
            onClick={() => { if (selectedProduct) nextStep(); else alert("Please select a product"); }}
            className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 text-white py-4 px-8 rounded-lg font-semibold hover:shadow-lg hover:shadow-rose-500/30 transition-all"
          >Continue →</button>
        </div>
      </div>
    );
  };

  const renderBasic = () => (
    <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm p-11">
      <h2 className="font-bold text-2xl mb-3">Quick Details</h2>
      <p className="text-white/60 mb-8">Helps personalize your report.</p>
      <div className="space-y-6">
        <div>
          <label className="block mb-3 font-medium">Email</label>
          <input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-4 text-white outline-none focus:border-rose-500" />
        </div>
        <div>
          <label className="block mb-3 font-medium">Company</label>
          <input type="text" placeholder="Acme Inc" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-4 text-white outline-none focus:border-rose-500" />
        </div>
        <div>
          <label className="block mb-3 font-medium">Role</label>
          <input type="text" placeholder="VP Marketing" value={role} onChange={(e) => setRole(e.target.value)} className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-4 text-white outline-none focus:border-rose-500" />
        </div>
        <div>
          <label className="block mb-3 font-medium">Company size</label>
          <div className="flex flex-wrap gap-2">
            {["1-10", "11-50", "51-200", "201-500", "500+"].map((opt) => (
              <button key={opt} onClick={() => setCompanySize(opt)} className={`px-4 py-3 rounded-lg border-2 transition-all ${companySize === opt ? "border-rose-500 bg-rose-500/10" : "border-white/15 bg-white/5 hover:border-rose-500/40"}`}>{opt}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block mb-3 font-medium">CRM</label>
          <div className="flex flex-wrap gap-2">
            {["HubSpot", "Salesforce", "Other", "None"].map((opt) => (
              <button key={opt} onClick={() => setCrm(opt)} className={`px-4 py-3 rounded-lg border-2 transition-all ${crm === opt ? "border-rose-500 bg-rose-500/10" : "border-white/15 bg-white/5 hover:border-rose-500/40"}`}>{opt}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-3 mt-7">
        <button onClick={prevStep} className="bg-white/5 border border-white/15 text-white py-4 px-8 rounded-lg font-medium hover:bg-white/10 transition-all">← Back</button>
        <button onClick={saveBasicAndNext} className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 text-white py-4 px-8 rounded-lg font-semibold hover:shadow-lg hover:shadow-rose-500/30 transition-all">Continue →</button>
      </div>
    </div>
  );

  const renderResearch = (phaseKey: string, title: string) => {
    const r = research[phaseKey as keyof typeof research];
    if (r.loading || !r.initial) {
      return (
        <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm p-11">
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-white/10 border-t-rose-500 rounded-full animate-spin mx-auto mb-5" />
            <h3 className="font-semibold text-xl mb-2">Analyzing {domain}</h3>
            <p className="text-white/60">Researching {title.toLowerCase()}...</p>
          </div>
        </div>
      );
    }
    const displayText = r.refined || r.initial;
    const isRefined = !!r.refined;
    return (
      <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm p-11">
        <div className={`inline-block px-3.5 py-1.5 rounded-full text-xs font-bold tracking-wide mb-4 ${isRefined ? "bg-green-500/15 text-green-500" : "bg-rose-500/15 text-rose-500"}`}>{isRefined ? "✓ REFINED" : "INITIAL ANALYSIS"}</div>
        <h2 className="font-bold text-2xl mb-2">{title}</h2>
        <p className="text-white/60 mb-2">Review and add corrections if needed.</p>
        <div className="bg-gradient-to-br from-black/40 to-black/20 border border-white/10 rounded-2xl p-7 my-6">{formatResearchOutput(displayText, phaseKey)}</div>
        <div className="bg-gradient-to-br from-rose-500/10 to-rose-500/5 border border-rose-500/20 rounded-xl p-6 mt-6">
          <div className="font-medium mb-3">Anything to correct?</div>
          <textarea rows={3} placeholder="e.g., We focus on enterprise..." value={r.feedback} onChange={(e) => setResearch(prev => ({ ...prev, [phaseKey]: { ...prev[phaseKey as keyof typeof prev], feedback: e.target.value } }))} className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-4 text-white outline-none focus:border-rose-500 resize-y" />
          <button onClick={async () => {
            if (!r.feedback.trim()) return;
            setResearch(prev => ({ ...prev, [phaseKey]: { ...prev[phaseKey as keyof typeof prev], loading: true } }));
            const isCompetitive = phaseKey === "competitive";
            const prompt = `You are an expert GTM strategist. Below is your original analysis and the user's feedback.

ORIGINAL ANALYSIS:
${r.initial}

USER FEEDBACK:
${r.feedback}

CRITICAL INSTRUCTIONS:
1. You are the expert. Do NOT simply accept all feedback.
2. If feedback provides useful CONTEXT (company details, market info, corrections to facts), incorporate it.
3. If feedback tries to CHANGE your strategic recommendations without good reason, push back. Explain why your original position is correct.
4. If feedback contradicts GTM best practices, politely disagree and maintain your expert stance.
${isCompetitive ? `5. COMPETITIVE ANALYSIS SPECIAL RULES:
   - If user suggests NEW COMPETITORS, you MUST add them to the COMPARISON TABLE
   - Keep the exact table format: Competitor | Their Strength | Their Weakness | Where You Win
   - Research the new competitors and provide real insights, not placeholders
   - Maintain all existing competitors in the table unless user explicitly says to remove them
6.` : `5.`} At the end, add a section called "ANALYST NOTES" that briefly explains:
   - What feedback you incorporated and why
   - What feedback you respectfully disagreed with and why

Use the same ALL CAPS headers as the original. Write TO them using "you/your". No preamble - start with the first header.`;
            const refined = await callClaude(prompt);
            setResearch(prev => ({ ...prev, [phaseKey]: { ...prev[phaseKey as keyof typeof prev], refined, loading: false } }));
          }} className="mt-3 px-6 py-3 rounded-lg border-2 border-rose-500 text-rose-500 font-semibold hover:bg-rose-500/10 transition-all">Refine</button>
        </div>
        <div className="flex gap-3 mt-7">
          <button onClick={prevStep} className="bg-white/5 border border-white/15 text-white py-4 px-8 rounded-lg font-medium hover:bg-white/10 transition-all">← Back</button>
          <button onClick={nextStep} className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 text-white py-4 px-8 rounded-lg font-semibold hover:shadow-lg hover:shadow-rose-500/30 transition-all">Looks Good →</button>
        </div>
      </div>
    );
  };

  const renderSignals = () => (
    <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm p-11">
      <h2 className="font-bold text-2xl mb-3">Your Signal Stack</h2>
      <p className="text-white/60 mb-6">Which tools detect buying signals?</p>
      <div className="grid grid-cols-3 gap-3 mb-8">
        {signalVendors.map((v) => (
          <div key={v.id} onClick={() => setSelectedVendors(prev => prev.includes(v.id) ? prev.filter(x => x !== v.id) : [...prev, v.id])} className={`p-4 rounded-xl border-2 cursor-pointer text-center transition-all ${selectedVendors.includes(v.id) ? "border-rose-500 bg-rose-500/10" : "border-white/15 bg-white/5 hover:border-rose-500/40"}`}>
            <img src={v.logo} alt={v.name} className="w-11 h-11 object-contain rounded-lg bg-white p-1 mx-auto mb-2" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div className="text-xs font-semibold">{v.name}</div>
          </div>
        ))}
        <div onClick={() => setSelectedVendors(prev => prev.includes("none") ? prev.filter(x => x !== "none") : [...prev, "none"])} className={`p-4 rounded-xl border-2 cursor-pointer text-center transition-all ${selectedVendors.includes("none") ? "border-rose-500 bg-rose-500/10" : "border-white/15 bg-white/5 hover:border-rose-500/40"}`}>
          <div className="text-3xl mb-2">🚫</div>
          <div className="text-xs font-semibold">None</div>
        </div>
      </div>
      <h3 className="text-lg font-semibold text-rose-500 mt-8 mb-4">What signals do you track?</h3>
      <div className="grid grid-cols-2 gap-2">
        {signalTypes.map((s) => (
          <div key={s.id} onClick={() => setSelectedSignals(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])} className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${selectedSignals.includes(s.id) ? "border-rose-500 bg-rose-500/10" : "border-white/15 bg-white/5 hover:border-rose-500/40"}`}>
            <div className="font-semibold text-sm">{s.label}</div>
            <div className="text-xs text-white/40">{s.desc}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-7">
        <button onClick={prevStep} className="bg-white/5 border border-white/15 text-white py-4 px-8 rounded-lg font-medium hover:bg-white/10 transition-all">← Back</button>
        <button onClick={nextStep} className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 text-white py-4 px-8 rounded-lg font-semibold hover:shadow-lg hover:shadow-rose-500/30 transition-all">Continue →</button>
      </div>
    </div>
  );

  const renderAlignment = () => (
    <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm p-11">
      <h2 className="font-bold text-2xl mb-3">Team Alignment</h2>
      <p className="text-white/60 mb-8">How connected are Marketing, Sales, CS?</p>
      <div className="space-y-6">
        <div>
          <label className="block mb-3 font-medium">GTM motion?</label>
          <div className="flex flex-col gap-2">
            {[{ v: "random", l: "Random acts of GTM" }, { v: "siloed", l: "Siloed teams" }, { v: "coordinated", l: "Coordinated but gaps" }, { v: "integrated", l: "Integrated" }, { v: "unified", l: "Unified revenue engine" }].map((opt) => (
              <button key={opt.v} onClick={() => setAlignment(prev => ({ ...prev, gtm: opt.v }))} className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${alignment.gtm === opt.v ? "border-rose-500 bg-rose-500/10" : "border-white/15 bg-white/5 hover:border-rose-500/40"}`}>{opt.l}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-3 mt-7">
        <button onClick={prevStep} className="bg-white/5 border border-white/15 text-white py-4 px-8 rounded-lg font-medium hover:bg-white/10 transition-all">← Back</button>
        <button onClick={() => setCurrentStep(steps.indexOf("generating"))} className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 text-white py-4 px-8 rounded-lg font-semibold hover:shadow-lg hover:shadow-rose-500/30 transition-all">Generate Report →</button>
      </div>
    </div>
  );

  const renderGenerating = () => (
    <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm p-11">
      <div className="text-center py-12">
        <div className="w-12 h-12 border-4 border-white/10 border-t-rose-500 rounded-full animate-spin mx-auto mb-5" />
        <h3 className="font-semibold text-xl mb-2">Building Your Report</h3>
        <p className="text-white/60">Synthesizing research...</p>
      </div>
    </div>
  );

 const renderResults = () => {
    if (!reportData) return renderGenerating();
    
    const getContentGrade = () => {
      const content = reportData.content || "";
      const match = content.match(/CONTENT GRADE:\s*([A-F])/i);
      return match ? match[1] : "?";
    };
    
    const grade = getContentGrade();
    const gradeColors: {[key: string]: string} = {
      "A": "text-green-400 border-green-400",
      "B": "text-green-300 border-green-300", 
      "C": "text-yellow-400 border-yellow-400",
      "D": "text-orange-400 border-orange-400",
      "F": "text-red-400 border-red-400",
      "?": "text-white/40 border-white/40"
    };

    const parseCompetitors = () => {
      const text = reportData.competitive || "";
      const lines = text.split('\n').filter(l => l.includes('|') && !l.includes('Competitor'));
      return lines.slice(0, 5).map(line => {
        const parts = line.split('|').map(p => p.trim());
        return { name: parts[0] || "", strength: parts[1] || "", weakness: parts[2] || "", youWin: parts[3] || "" };
      });
    };

    const competitors = parseCompetitors();
    
    const downloadPDF = () => {
      const safeClean = (text: string) => text ? cleanResponse(text) : "(No data)";
      const content = `GTM OPERATING SYSTEM DIAGNOSTIC\nFor: ${companyName || domain} - ${selectedProduct}\nGenerated by Smoke Signals AI\n\nEXECUTIVE NARRATIVE\n${safeClean(reportData?.narrative)}\n\nICP & PERSONAS\n${safeClean(reportData?.icp)}\n\nCOMPETITIVE LANDSCAPE\n${safeClean(reportData?.competitive)}\n\nCONTENT STRATEGY\n${safeClean(reportData?.content)}`;
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GTM-Diagnostic-${(domain || "report").replace(/[^a-z0-9]/gi, '-')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">📊</div>
          <h2 className="font-bold text-2xl mb-1">{companyName || domain}</h2>
          <p className="text-rose-400 font-medium">{selectedProduct}</p>
          <button onClick={downloadPDF} className="mt-4 bg-white/10 border border-white/20 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-white/15 transition-all">
            Download Report
          </button>
        </div>

        {/* Score Cards Row */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 text-center">
            <div className={`text-4xl font-bold mb-1 ${gradeColors[grade]}`}>{grade}</div>
            <div className="text-white/50 text-sm">Content Grade</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 text-center">
            <div className="text-4xl font-bold mb-1 text-rose-400">{competitors.length}</div>
            <div className="text-white/50 text-sm">Competitors Mapped</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 text-center">
            <div className="text-4xl font-bold mb-1 text-purple-400">{alignment.gtm || "—"}</div>
            <div className="text-white/50 text-sm">GTM Stage</div>
          </div>
        </div>

        {/* The Bottom Line */}
        <div className="bg-gradient-to-r from-rose-500/20 to-purple-500/20 border border-rose-500/30 rounded-2xl p-6">
          <h3 className="font-bold text-lg mb-3 text-rose-400">The Bottom Line</h3>
          <div className="text-white/90 leading-relaxed">
            {cleanResponse(reportData.narrative).split("\n\n").map((p, i) => (
              <p key={i} className="mb-3 last:mb-0">{p}</p>
            ))}
          </div>
        </div>

        {/* Competitive Grid */}
        {competitors.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 className="font-bold text-lg mb-4">Competitive Snapshot</h3>
            <div className="space-y-3">
              {competitors.map((c, i) => (
                <div key={i} className="grid grid-cols-4 gap-3 text-sm">
                  <div className="font-semibold text-white">{c.name}</div>
                  <div className="text-green-400/80">✓ {c.strength}</div>
                  <div className="text-red-400/80">✗ {c.weakness}</div>
                  <div className="text-rose-400">→ {c.youWin}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Personas */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h3 className="font-bold text-lg mb-4">Your Buyers</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {parsePersonas(cleanResponse(reportData.icp).split("\n")).slice(0, 4).map((p, i) => (
              <div key={i} className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4">
                <div className="font-semibold text-purple-300 mb-1">{p.title}</div>
                <div className="text-white/70 text-sm">{p.goal}</div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-r from-rose-500 to-rose-600 rounded-2xl p-8 text-center">
          <h3 className="font-bold text-xl mb-2">Ready to fix the gaps?</h3>
          <p className="text-white/80 mb-4">Let's talk about turning this diagnostic into action.</p>
          <a href="https://smokesignals.ai/contact" target="_blank" rel="noopener noreferrer" className="inline-block bg-white text-rose-600 font-semibold py-3 px-8 rounded-lg hover:bg-white/90 transition-all">
            Book a Strategy Session
          </a>
        </div>
      </div>
    );
  };

  const step = steps[currentStep];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <img src="https://smokesignals.ai/hs-fs/hubfs/Smoke_Signals/img/smokesignal-logo.png" alt="Smoke Signals AI" className="h-10 mx-auto mb-4" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <h1 className="text-3xl font-bold">GTM Operating System Diagnostic</h1>
          <p className="text-white/60 mt-2">AI-powered analysis of your go-to-market engine</p>
        </div>
        {renderStepIndicator()}
        {step === "intro" && renderIntro()}
        {step === "select-product" && renderSelectProduct()}
        {step === "basic" && renderBasic()}
        {step === "research-company" && renderResearch("company", "Company Analysis")}
        {step === "research-icp" && renderResearch("icp", "Ideal Customer Profile")}
        {step === "research-competitive" && renderResearch("competitive", "Competitive Landscape")}
        {step === "research-content" && renderResearch("content", "Content Strategy")}
        {step === "signals" && renderSignals()}
        {step === "alignment" && renderAlignment()}
        {step === "generating" && renderGenerating()}
        {step === "results" && renderResults()}
      </div>
    </div>
  );
}
