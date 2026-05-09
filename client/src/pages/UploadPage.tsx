import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, Play, Film, AlertCircle, CheckCircle2 } from "lucide-react";

const MAX_FILE_SIZE_MB = 100;
const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"];

export default function UploadPage() {
  const [, navigate] = useLocation();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createCritique = trpc.critique.create.useMutation({
    onSuccess: (data) => {
      navigate(`/processing/${data.critiqueId}`);
    },
    onError: (err) => {
      toast.error(`Failed to start critique: ${err.message}`);
      setIsUploading(false);
    },
  });

  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return "Please upload an MP4, MOV, WebM, or AVI file.";
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return `File must be under ${MAX_FILE_SIZE_MB}MB.`;
    }
    return null;
  };

  const handleFileSelect = useCallback((file: File) => {
    const error = validateFile(file);
    if (error) { toast.error(error); return; }
    setSelectedFile(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Upload to backend via multipart form
      const formData = new FormData();
      formData.append("video", selectedFile);

      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      const uploadResult = await new Promise<{ key: string; url: string }>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve(JSON.parse(xhr.responseText));
          } else if (xhr.status === 413) {
            reject(new Error(`File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`));
          } else if (xhr.status === 400) {
            try {
              const body = JSON.parse(xhr.responseText);
              reject(new Error(body.error ?? "Invalid file. Please upload an MP4, MOV, WebM, or AVI."));
            } catch {
              reject(new Error("Invalid file format."));
            }
          } else {
            try {
              const body = JSON.parse(xhr.responseText);
              reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload. Please check your connection."));
        xhr.open("POST", "/api/upload-video");
        xhr.send(formData);
      });

      setUploadProgress(100);

      // Start the critique pipeline
      await createCritique.mutateAsync({
        originalVideoKey: uploadResult.key,
        originalVideoUrl: uploadResult.url,
      });
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed. Please try again.");
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
          <span className="timecode">UPLOAD YOUR AD</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center py-16">
        <div className="container max-w-2xl">
          <div className="text-center mb-10">
            <span className="timecode mb-3 block">// STEP 1 OF 3</span>
            <h1 className="text-4xl font-bold mb-3">
              Upload Your <span className="text-primary">Marketing Ad</span>
            </h1>
            <p className="text-muted-foreground">
              Drop your video and our AI marketing guru will analyze every frame, generate expert feedback, and return an annotated critique video.
            </p>
          </div>

          {/* Dropzone */}
          <div
            className={`studio-card rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer ${isDragging ? "dropzone-active" : "border-border hover:border-primary/30"}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => !selectedFile && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-msvideo"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />

            {!selectedFile ? (
              <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                  <Upload className="w-7 h-7 text-primary" />
                </div>
                <p className="text-lg font-semibold mb-2">Drop your video here</p>
                <p className="text-muted-foreground text-sm mb-4">or click to browse files</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {["MP4", "MOV", "WebM", "AVI"].map(fmt => (
                    <span key={fmt} className="text-xs px-2 py-1 rounded bg-secondary text-muted-foreground font-mono">{fmt}</span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3">Max file size: {MAX_FILE_SIZE_MB}MB</p>
              </div>
            ) : (
              <div className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <Film className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                </div>

                {/* Video preview */}
                <video
                  src={URL.createObjectURL(selectedFile)}
                  className="w-full rounded-xl max-h-48 object-contain bg-black"
                  controls
                  muted
                />
              </div>
            )}
          </div>

          {/* Upload progress */}
          {isUploading && uploadProgress < 100 && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">Uploading...</span>
                <span className="text-primary font-mono">{uploadProgress}%</span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Info cards */}
          <div className="grid grid-cols-3 gap-3 mt-6">
            {[
              { icon: "🧠", label: "GPT-4o Analysis", desc: "Frame-by-frame AI review" },
              { icon: "🎙️", label: "ElevenLabs Voice", desc: "Expert voiceover" },
              { icon: "🎯", label: "Visual Annotations", desc: "Circles on key elements" },
            ].map((item, i) => (
              <div key={i} className="studio-card rounded-xl p-4 text-center">
                <span className="text-2xl block mb-2">{item.icon}</span>
                <p className="text-xs font-semibold mb-1">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-6 flex flex-col items-center gap-3">
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-black font-bold text-base px-10 amber-glow w-full sm:w-auto"
              disabled={!selectedFile || isUploading}
              onClick={handleUpload}
            >
              {isUploading ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  {uploadProgress < 100 ? `Uploading ${uploadProgress}%...` : "Starting analysis..."}
                </>
              ) : (
                <>
                  <Play className="mr-2 w-4 h-4 fill-black" />
                  Analyze My Ad
                </>
              )}
            </Button>
            {selectedFile && !isUploading && (
              <button
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
              >
                Choose a different file
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
