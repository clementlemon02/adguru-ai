import { useRef, useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Play, Download, RotateCcw, ChevronRight, Star, TrendingUp, AlertTriangle, Loader2 } from "lucide-react";
interface CritiquePoint {
  timestamp: number;
  timecode: string;
  type: "strength" | "improvement" | "warning";
  title: string;
  description: string;
  annotation?: { x: number; y: number; w: number; h: number; label: string };
}

interface AnalysisReport {
  overallScore: number;
  hookScore: number;
  ctaScore: number;
  visualScore: number;
  pacingScore: number;
  emotionScore: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  critiquePoints: CritiquePoint[];
  videoDuration: number;
}

// ─── Score Ring ───────────────────────────────────────────────
function ScoreRing({ score, label, size = 80 }: { score: number; label: string; size?: number }) {
  const ref = useRef<SVGCircleElement>(null);
  const [animated, setAnimated] = useState(false);
  const r = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 200);
    return () => clearTimeout(timer);
  }, []);

  const color = score >= 75 ? "oklch(0.60 0.18 140)" : score >= 50 ? "oklch(0.75 0.18 65)" : "oklch(0.55 0.22 25)";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" className="score-ring-bg" />
          <circle
            ref={ref}
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6"
            stroke={color}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={animated ? offset : circ}
            style={{ transition: "stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-sm font-bold" style={{ color }}>{score}</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Critique Point Card ──────────────────────────────────────
function CritiqueCard({ point }: { point: CritiquePoint }) {
  const badgeClass = point.type === "strength" ? "badge-strength" : point.type === "warning" ? "badge-warning" : "badge-improvement";
  const Icon = point.type === "strength" ? Star : point.type === "warning" ? AlertTriangle : TrendingUp;

  return (
    <div className="studio-card studio-card-hover rounded-xl p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${badgeClass}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm">{point.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${badgeClass}`}>
              {point.timecode}
            </span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${badgeClass}`}>
            {point.type}
          </span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{point.description}</p>
      {point.annotation && (
        <div className="mt-3 text-xs text-muted-foreground font-mono flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-primary inline-block" />
          Annotated: {point.annotation.label}
        </div>
      )}
    </div>
  );
}

// ─── Main Result Page ─────────────────────────────────────────
export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const critiqueId = parseInt(params.id ?? "0");

  const { data: critique, isLoading } = trpc.critique.getById.useQuery(
    { id: critiqueId },
    { enabled: !!critiqueId }
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!critique || critique.status !== "completed") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-center">
        <div>
          <p className="text-muted-foreground mb-4">Critique not found or still processing.</p>
          <Button onClick={() => navigate("/upload")}>Upload New Ad</Button>
        </div>
      </div>
    );
  }

  const report = critique.reportJson as unknown as AnalysisReport;
  const critiquePoints = report?.critiquePoints ?? [];
  const strengths = critiquePoints.filter(p => p.type === "strength");
  const improvements = critiquePoints.filter(p => p.type !== "strength");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border py-4 sticky top-0 z-50 bg-background/90 backdrop-blur-md">
        <div className="container flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Play className="w-4 h-4 text-black fill-black" />
            </div>
            <span className="font-bold text-lg">AdGuru <span className="text-primary">AI</span></span>
          </a>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate("/upload")}>
              <RotateCcw className="w-4 h-4 mr-2" /> New Critique
            </Button>
            {critique.critiqueVideoUrl && (
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-black font-bold" asChild>
                <a href={critique.critiqueVideoUrl} download>
                  <Download className="w-4 h-4 mr-2" /> Download
                </a>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="py-10">
        <div className="container">
          <div className="mb-8">
            <span className="timecode mb-2 block">// STEP 3 OF 3 — YOUR CRITIQUE</span>
            <h1 className="text-4xl font-bold mb-2">
              Your Ad Has Been <span className="text-primary">Reviewed</span>
            </h1>
            <p className="text-muted-foreground">{report?.summary}</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Left: Video + Scores */}
            <div className="lg:col-span-2 space-y-6">
              {/* Critique Video Player */}
              <div className="studio-card rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-border flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="timecode">CRITIQUE VIDEO</span>
                </div>
                {critique.critiqueVideoUrl ? (
                  <video
                    src={critique.critiqueVideoUrl}
                    controls
                    className="w-full bg-black"
                    style={{ maxHeight: "480px" }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-64 text-muted-foreground">
                    <p>Video processing...</p>
                  </div>
                )}
              </div>

              {/* Score Report Card */}
              <div className="studio-card rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-6">
                  <span className="timecode">PERFORMANCE REPORT CARD</span>
                </div>
                <div className="flex items-center justify-around flex-wrap gap-4 mb-6">
                  <ScoreRing score={report?.hookScore ?? 0} label="Hook" size={90} />
                  <ScoreRing score={report?.ctaScore ?? 0} label="CTA" size={90} />
                  <ScoreRing score={report?.visualScore ?? 0} label="Visual" size={90} />
                  <ScoreRing score={report?.pacingScore ?? 0} label="Pacing" size={90} />
                  <ScoreRing score={report?.emotionScore ?? 0} label="Emotion" size={90} />
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <span className="text-sm text-muted-foreground">Overall Score</span>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-32 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-1000"
                        style={{ width: `${report?.overallScore ?? 0}%` }}
                      />
                    </div>
                    <span className="font-mono font-bold text-primary">{report?.overallScore ?? 0}/100</span>
                  </div>
                </div>
              </div>

              {/* Key Takeaways */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="studio-card rounded-xl p-5">
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Star className="w-4 h-4 text-green-400" /> What's Working
                  </h3>
                  <ul className="space-y-2">
                    {(report?.strengths ?? []).map((s: string, i: number) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <ChevronRight className="w-3 h-3 text-green-400 flex-shrink-0 mt-1" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="studio-card rounded-xl p-5">
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" /> Top Improvements
                  </h3>
                  <ul className="space-y-2">
                    {(report?.improvements ?? []).map((s: string, i: number) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <ChevronRight className="w-3 h-3 text-primary flex-shrink-0 mt-1" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Right: Critique Timeline */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="timecode">CRITIQUE TIMELINE</span>
                <span className="text-xs text-muted-foreground">{critiquePoints.length} points</span>
              </div>
              <div className="space-y-3 max-h-[800px] overflow-y-auto pr-1">
                {critiquePoints.map((point: CritiquePoint, i: number) => (
                  <CritiqueCard key={i} point={point} />
                ))}
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-12 text-center studio-card rounded-2xl p-10">
            <h2 className="text-3xl font-bold mb-3">
              Ready to Make a <span className="text-primary">Better Ad?</span>
            </h2>
            <p className="text-muted-foreground mb-6">Upload your revised version and see how much your scores improve.</p>
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-black font-bold px-10 amber-glow"
              onClick={() => navigate("/upload")}
            >
              Critique Another Ad <ChevronRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
