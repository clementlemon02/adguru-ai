import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Play, Film, CheckCircle2, Loader2, XCircle, Clock, ChevronRight } from "lucide-react";

const STATUS_CONFIG = {
  uploading: { label: "Uploading", icon: Loader2, color: "text-muted-foreground", spin: true },
  analyzing: { label: "Analyzing", icon: Loader2, color: "text-primary", spin: true },
  generating_voice: { label: "Generating Voice", icon: Loader2, color: "text-primary", spin: true },
  rendering: { label: "Rendering", icon: Loader2, color: "text-primary", spin: true },
  completed: { label: "Completed", icon: CheckCircle2, color: "text-green-400", spin: false },
  failed: { label: "Failed", icon: XCircle, color: "text-destructive", spin: false },
};

export default function HistoryPage() {
  const [, navigate] = useLocation();
  const { data: critiques, isLoading } = trpc.critique.list.useQuery();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border py-4 sticky top-0 z-50 bg-background/90 backdrop-blur-md">
        <div className="container flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Play className="w-4 h-4 text-black fill-black" />
            </div>
            <span className="font-bold text-lg">AdGuru <span className="text-primary">AI</span></span>
          </a>
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-black font-bold"
            onClick={() => navigate("/upload")}
          >
            New Critique
          </Button>
        </div>
      </header>

      <main className="py-10">
        <div className="container max-w-3xl">
          <div className="mb-8">
            <span className="timecode mb-2 block">// YOUR CRITIQUES</span>
            <h1 className="text-4xl font-bold">Critique History</h1>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : !critiques?.length ? (
            <div className="studio-card rounded-2xl p-16 text-center">
              <Film className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">No critiques yet</h2>
              <p className="text-muted-foreground mb-6">Upload your first marketing ad to get started.</p>
              <Button
                className="bg-primary hover:bg-primary/90 text-black font-bold"
                onClick={() => navigate("/upload")}
              >
                Upload Your First Ad
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {critiques.map((critique) => {
                const statusCfg = STATUS_CONFIG[critique.status] ?? STATUS_CONFIG.analyzing;
                const StatusIcon = statusCfg.icon;
                const report = critique.reportJson as any;
                const isClickable = critique.status === "completed";
                const isProcessing = !["completed", "failed"].includes(critique.status);

                return (
                  <div
                    key={critique.id}
                    className={`studio-card studio-card-hover rounded-xl p-5 flex items-center gap-4 ${isClickable ? "cursor-pointer" : ""}`}
                    onClick={() => isClickable && navigate(`/result/${critique.id}`)}
                  >
                    <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                      <Film className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm truncate">
                          Critique #{critique.id}
                        </span>
                        <span className={`flex items-center gap-1 text-xs ${statusCfg.color}`}>
                          <StatusIcon className={`w-3 h-3 ${statusCfg.spin ? "animate-spin" : ""}`} />
                          {statusCfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(critique.createdAt).toLocaleDateString()}
                        </span>
                        {isProcessing && critique.processingStep && (
                          <span className="text-primary">{critique.processingStep}</span>
                        )}
                        {critique.status === "completed" && report?.overallScore != null && (
                          <span className="font-mono text-primary">Score: {report.overallScore}/100</span>
                        )}
                      </div>
                    </div>
                    {isClickable && (
                      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
