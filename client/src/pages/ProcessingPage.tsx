import { useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Play, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const PIPELINE_STEPS = [
  { key: "analyzing", label: "Analyzing with GPT-4o", desc: "Extracting frames and analyzing marketing elements..." },
  { key: "generating_voice", label: "Generating Voiceover", desc: "ElevenLabs is synthesizing expert commentary..." },
  { key: "rendering", label: "Rendering Critique Video", desc: "Drawing annotations and syncing audio..." },
  { key: "completed", label: "Critique Ready!", desc: "Your annotated video is ready to watch." },
];

function getStepState(stepKey: string, currentStatus: string) {
  const stepOrder = ["analyzing", "generating_voice", "rendering", "completed"];
  const currentIdx = stepOrder.indexOf(currentStatus);
  const stepIdx = stepOrder.indexOf(stepKey);
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

export default function ProcessingPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const critiqueId = parseInt(params.id ?? "0");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const utils = trpc.useUtils();
  const { data: critique, isLoading } = trpc.critique.getById.useQuery(
    { id: critiqueId },
    { enabled: !!critiqueId, refetchInterval: false }
  );

  // Poll for status updates
  useEffect(() => {
    if (!critiqueId) return;

    const poll = async () => {
      await utils.critique.getById.invalidate({ id: critiqueId });
    };

    intervalRef.current = setInterval(poll, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [critiqueId, utils]);

  // Navigate when done or failed
  useEffect(() => {
    if (critique?.status === "completed") {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setTimeout(() => navigate(`/result/${critiqueId}`), 1500);
    }
    if (critique?.status === "failed") {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [critique?.status, critiqueId, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const status = critique?.status ?? "analyzing";
  const isFailed = status === "failed";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border py-4">
        <div className="container flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Play className="w-4 h-4 text-black fill-black" />
            </div>
            <span className="font-bold text-lg">AdGuru <span className="text-primary">AI</span></span>
          </a>
          <span className="timecode">PROCESSING</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center py-16">
        <div className="container max-w-xl text-center">
          <span className="timecode mb-3 block">// STEP 2 OF 3</span>
          <h1 className="text-4xl font-bold mb-3">
            {isFailed ? "Processing Failed" : "Analyzing Your Ad"}
          </h1>
          <p className="text-muted-foreground mb-12">
            {isFailed
              ? "Something went wrong during processing. Please try again."
              : "Our AI marketing guru is watching your ad frame by frame. This usually takes 2–4 minutes."}
          </p>

          {/* Pipeline steps */}
          <div className="space-y-4 text-left mb-10">
            {PIPELINE_STEPS.map((step, i) => {
              const state = isFailed ? (i === 0 ? "active" : "pending") : getStepState(step.key, status);
              return (
                <div key={step.key} className={`studio-card rounded-xl p-4 flex items-start gap-4 transition-all duration-500 ${state === "active" ? "border-primary/40 amber-glow" : ""}`}>
                  <div className="flex-shrink-0 mt-0.5">
                    {state === "done" && <CheckCircle2 className="w-5 h-5 step-done" />}
                    {state === "active" && !isFailed && <Loader2 className="w-5 h-5 step-active animate-spin" />}
                    {state === "active" && isFailed && <XCircle className="w-5 h-5 text-destructive" />}
                    {state === "pending" && <Circle className="w-5 h-5 step-pending" />}
                  </div>
                  <div className="flex-1">
                    <p className={`font-semibold text-sm ${state === "active" ? "step-active" : state === "done" ? "step-done" : "step-pending"}`}>
                      {step.label}
                    </p>
                    {state === "active" && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {isFailed ? critique?.errorMessage ?? "Unknown error" : (critique?.processingStep ?? step.desc)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Animated progress bar */}
          {!isFailed && status !== "completed" && (
            <div className="h-1 bg-secondary rounded-full overflow-hidden mb-6">
              <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: "60%" }} />
            </div>
          )}

          {isFailed && (
            <Button
              className="bg-primary hover:bg-primary/90 text-black font-bold"
              onClick={() => navigate("/upload")}
            >
              Try Again
            </Button>
          )}

          {status === "completed" && (
            <div className="flex items-center justify-center gap-2 text-green-400 font-semibold">
              <CheckCircle2 className="w-5 h-5" />
              Redirecting to your critique...
            </div>
          )}

          {/* Fun fact while waiting */}
          {!isFailed && status !== "completed" && (
            <p className="text-xs text-muted-foreground mt-8 font-mono">
              💡 Did you know? 76% of ads fail to hook viewers in the first 3 seconds.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
