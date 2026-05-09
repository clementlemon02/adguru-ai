/* ============================================================
   AdGuru AI — Home Page
   Design: "Dark Studio" — Cinematic Post-Production Aesthetic
   Charcoal black + Amber accent, Space Grotesk + JetBrains Mono
   ============================================================ */
import { useState, useEffect, useRef } from "react";
import { motion, useInView, useAnimation } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play, Upload, Mic2, Layers, Download, ChevronRight,
  Target, TrendingUp, Users, Zap, Eye, BarChart3,
  CheckCircle2, ArrowRight, Star, Circle
} from "lucide-react";
import { toast } from "sonner";

// ─── Asset URLs ──────────────────────────────────────────────
const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/87723036/ZtT8VRJULmc2evYzWg4uAB/adguru-hero-bg-oKmfPQP622oyfWgSkfvbgT.webp";
const ANNOTATION_MOCKUP = "https://d2xsxph8kpxj0f.cloudfront.net/87723036/ZtT8VRJULmc2evYzWg4uAB/adguru-annotation-mockup-dLKRkMSnjyF5ofoogvhHy4.webp";
const REPORT_CARD = "https://d2xsxph8kpxj0f.cloudfront.net/87723036/ZtT8VRJULmc2evYzWg4uAB/adguru-report-card-PDfFKj27dxZaaPnj8viMCf.webp";
const WAVEFORM_BG = "https://d2xsxph8kpxj0f.cloudfront.net/87723036/ZtT8VRJULmc2evYzWg4uAB/adguru-waveform-bg-nEuTneei4jW9k969XVQVrD.webp";

// ─── Animated Counter ────────────────────────────────────────
function AnimatedCounter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const duration = 1800;
    const step = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [inView, target]);

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

// ─── Score Ring SVG ──────────────────────────────────────────
function ScoreRing({ score, label, size = 80 }: { score: number; label: string; size?: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <div ref={ref} className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" className="score-ring-bg" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6"
            className="score-ring"
            strokeDasharray={circ}
            strokeDashoffset={inView ? offset : circ}
            style={{ transition: "stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-sm font-bold text-amber-400">{score}</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Fade In on Scroll ───────────────────────────────────────
function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Navbar ──────────────────────────────────────────────────
function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/90 backdrop-blur-md border-b border-border" : ""}`}>
      <div className="container flex items-center justify-between h-16">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
            <Play className="w-4 h-4 text-black fill-black" />
          </div>
          <span className="font-bold text-lg tracking-tight">AdGuru <span className="text-amber-400">AI</span></span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a>
          <a href="#features" className="hover:text-foreground transition-colors">Features</a>
          <a href="#stack" className="hover:text-foreground transition-colors">Tech Stack</a>
          <a href="#personas" className="hover:text-foreground transition-colors">Who It's For</a>
        </div>
        <Button
          size="sm"
          className="bg-amber-500 hover:bg-amber-400 text-black font-semibold"
          onClick={() => window.location.href = "/upload"}
        >
          Try It Free
        </Button>
      </div>
    </nav>
  );
}

// ─── Hero Section ────────────────────────────────────────────
function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        <img src={HERO_BG} alt="" className="w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
      </div>

      <div className="container relative z-10 pt-24 pb-16">
        <div className="max-w-3xl">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6"
          >
            <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 font-mono text-xs px-3 py-1">
              <span className="rec-dot" />
              AI-POWERED VIDEO CRITIQUE
            </Badge>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold leading-[1.05] tracking-tight mb-6"
          >
            Your Ad Has{" "}
            <span className="text-amber-400 amber-glow-text">3 Seconds</span>{" "}
            to Hook.
            <br />
            <span className="text-foreground/60">Does It?</span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="text-lg text-muted-foreground max-w-xl mb-8 leading-relaxed"
          >
            AdGuru AI watches your marketing video like a seasoned creative director — then returns an annotated critique video with voiceover, visual highlights, and a performance report card. In under 3 minutes.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="flex flex-wrap gap-4"
          >
            <Button
              size="lg"
              className="bg-amber-500 hover:bg-amber-400 text-black font-bold text-base px-8 amber-glow transition-all duration-300"
              onClick={() => window.location.href = "/upload"}
            >
              Analyze My Ad Free <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-border text-foreground hover:border-amber-500/40 hover:text-amber-400 font-semibold text-base px-8"
              onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
            >
              <Play className="mr-2 w-4 h-4" /> See How It Works
            </Button>
          </motion.div>

          {/* Timecode decoration */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="mt-10 flex items-center gap-6"
          >
            <span className="timecode">00:00:03 — HOOK WINDOW</span>
            <div className="h-px flex-1 max-w-xs bg-gradient-to-r from-amber-500/40 to-transparent" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─── Stats Section ───────────────────────────────────────────
function StatsSection() {
  const stats = [
    { value: 76, suffix: "%", label: "of ads fail in the first 3 seconds" },
    { value: 3, suffix: "min", label: "average critique turnaround time" },
    { value: 5, suffix: "x", label: "faster than a human agency review" },
    { value: 100, suffix: "%", label: "powered by your sponsor stack" },
  ];

  return (
    <section className="py-16 border-y border-border" style={{ backgroundImage: `url(${WAVEFORM_BG})`, backgroundSize: "cover" }}>
      <div className="container">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((s, i) => (
            <FadeIn key={i} delay={i * 0.1} className="text-center">
              <div className="text-4xl md:text-5xl font-bold text-amber-400 font-mono mb-1">
                <AnimatedCounter target={s.value} suffix={s.suffix} />
              </div>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Problem / Solution ──────────────────────────────────────
function ProblemSection() {
  return (
    <section className="py-24">
      <div className="container">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <FadeIn>
            <div>
              <span className="timecode mb-4 block">// THE PROBLEM</span>
              <h2 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
                Great ads aren't made by gut feeling.{" "}
                <span className="text-muted-foreground">They're engineered.</span>
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
                You spend thousands producing a video ad, then launch it blind. You find out it doesn't work after burning your budget. Agency feedback costs $500+ and takes a week. A/B testing takes days and requires traffic.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                There has never been a tool that watches your ad like a real marketing expert — pausing, pointing, and explaining exactly what's working and what's killing your ROAS — until now.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="space-y-4">
              {[
                { icon: "💸", title: "Agency reviews cost $500–$2,000", desc: "And take 5–7 business days to come back." },
                { icon: "🎲", title: "Gut-feel creative decisions", desc: "Most ad feedback is subjective and inconsistent." },
                { icon: "🔥", title: "Budget burned on bad creatives", desc: "You only discover the hook failed after spending money." },
                { icon: "⏳", title: "A/B tests take days", desc: "You need traffic to test, which costs even more money." },
              ].map((item, i) => (
                <div key={i} className="studio-card studio-card-hover rounded-lg p-4 flex gap-4">
                  <span className="text-2xl flex-shrink-0">{item.icon}</span>
                  <div>
                    <p className="font-semibold text-sm mb-1">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── How It Works ────────────────────────────────────────────
function HowItWorksSection() {
  const steps = [
    {
      icon: Upload,
      timecode: "00:00:01",
      title: "Upload Your Ad",
      desc: "Drop your MP4, MOV, or WebM file — or paste a YouTube/TikTok link. Any marketing video up to 100MB.",
      color: "text-amber-400",
    },
    {
      icon: Eye,
      timecode: "00:00:30",
      title: "AI Watches & Analyzes",
      desc: "Gemini 1.5 Pro analyzes every frame for hook quality, CTA placement, pacing, and visual hierarchy. Fal.ai SAM 3 tracks every object with pixel-perfect precision.",
      color: "text-amber-400",
    },
    {
      icon: Mic2,
      timecode: "00:01:00",
      title: "Guru Writes the Script",
      desc: "A timestamped critique script is generated. ElevenLabs converts it into a professional, human-sounding voiceover in the voice of a seasoned marketing director.",
      color: "text-amber-400",
    },
    {
      icon: Layers,
      timecode: "00:02:30",
      title: "Video is Annotated",
      desc: "Your original video plays back with glowing annotation circles drawn over specific elements. The video pauses when the guru has more to say. Audio is synced perfectly.",
      color: "text-amber-400",
    },
    {
      icon: Download,
      timecode: "00:03:00",
      title: "Download Your Critique",
      desc: "Receive the fully rendered critique video and a visual report card scoring your ad on Hook, CTA, Pacing, Visual Hierarchy, and Emotional Resonance.",
      color: "text-amber-400",
    },
  ];

  return (
    <section id="how-it-works" className="py-24 bg-card/30">
      <div className="container">
        <FadeIn className="text-center mb-16">
          <span className="timecode mb-3 block">// HOW IT WORKS</span>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            From Upload to Critique in{" "}
            <span className="text-amber-400">3 Minutes</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            A fully automated pipeline that turns any marketing video into an expert-level, annotated critique.
          </p>
        </FadeIn>

        <div className="relative">
          {/* Connector line */}
          <div className="hidden md:block absolute left-1/2 top-8 bottom-8 w-px bg-gradient-to-b from-amber-500/40 via-amber-500/20 to-transparent -translate-x-1/2" />

          <div className="space-y-8">
            {steps.map((step, i) => (
              <FadeIn key={i} delay={i * 0.1}>
                <div className={`flex gap-6 md:gap-12 items-start ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"}`}>
                  <div className={`flex-1 ${i % 2 === 0 ? "md:text-right" : "md:text-left"}`}>
                    <span className="timecode block mb-2">{step.timecode}</span>
                    <h3 className="text-xl font-bold mb-2">{step.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed max-w-sm ml-auto">{step.desc}</p>
                  </div>

                  {/* Step icon */}
                  <div className="flex-shrink-0 w-14 h-14 rounded-full studio-card border-2 border-amber-500/30 flex items-center justify-center z-10 amber-glow">
                    <step.icon className="w-6 h-6 text-amber-400" />
                  </div>

                  <div className="flex-1 hidden md:block" />
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Demo / Mockup Section ───────────────────────────────────
function DemoSection() {
  return (
    <section id="features" className="py-24">
      <div className="container">
        <div className="grid md:grid-cols-2 gap-12 items-center mb-20">
          <FadeIn>
            <span className="timecode mb-3 block">// THE CRITIQUE VIDEO</span>
            <h2 className="text-4xl font-bold mb-4">
              Watch Your Ad Get{" "}
              <span className="text-amber-400">Dissected Live</span>
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              The AI doesn't just write a report — it creates a reaction video. Your original ad plays, the guru's voice narrates, and glowing annotation circles appear exactly where the eye should go. It's like watching a senior creative director review your work in real time.
            </p>
            <div className="space-y-3">
              {[
                "Pixel-perfect circles powered by Fal.ai SAM 3 object tracking",
                "Human-quality voiceover via ElevenLabs voice synthesis",
                "Video pauses automatically when the guru has more to say",
                "Original audio ducks under the voiceover seamlessly",
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-muted-foreground">{item}</span>
                </div>
              ))}
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="relative rounded-xl overflow-hidden border border-border studio-card-hover">
              <img src={ANNOTATION_MOCKUP} alt="AdGuru AI annotation interface" className="w-full" />
              <div className="absolute inset-0 bg-gradient-to-t from-background/60 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  LIVE ANNOTATION DEMO
                </div>
              </div>
            </div>
          </FadeIn>
        </div>

        {/* Report Card */}
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <FadeIn delay={0.1} className="md:order-2">
            <span className="timecode mb-3 block">// THE REPORT CARD</span>
            <h2 className="text-4xl font-bold mb-4">
              A Score Card Your{" "}
              <span className="text-amber-400">Team Can Act On</span>
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              Every critique ends with a visual report card generated by Fal.ai. It scores your ad across five dimensions, shows an audience attention heatmap, and lists the top three improvements to make before your next launch.
            </p>
            <div className="grid grid-cols-5 gap-4">
              <ScoreRing score={82} label="Hook" />
              <ScoreRing score={65} label="CTA" />
              <ScoreRing score={91} label="Visual" />
              <ScoreRing score={74} label="Pacing" />
              <ScoreRing score={88} label="Emotion" />
            </div>
          </FadeIn>
          <FadeIn delay={0.2} className="md:order-1">
            <div className="relative rounded-xl overflow-hidden border border-border studio-card-hover">
              <img src={REPORT_CARD} alt="AdGuru AI report card" className="w-full" />
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── Tech Stack Section ──────────────────────────────────────
function TechStackSection() {
  const stack = [
    {
      name: "Gemini 1.5 Pro",
      role: "Video Analysis & Script Writing",
      desc: "Analyzes the ad frame-by-frame, understands audio, and generates the timestamped critique script.",
      badge: "Google",
      icon: "🧠",
    },
    {
      name: "Fal.ai SAM 3",
      role: "Object Tracking & Annotation",
      desc: "Tracks every element across every frame with pixel-perfect bounding boxes. Powers the annotation circles.",
      badge: "Fal.ai",
      icon: "🎯",
    },
    {
      name: "ElevenLabs",
      role: "Voice Synthesis",
      desc: "Converts the critique script into a professional, emotive voiceover in the voice of a marketing director.",
      badge: "ElevenLabs",
      icon: "🎙️",
    },
    {
      name: "Fal.ai Flux",
      role: "Report Card Generation",
      desc: "Generates the visual performance report card with score gauges and attention heatmaps.",
      badge: "Fal.ai",
      icon: "📊",
    },
    {
      name: "Daytona",
      role: "Secure Code Execution",
      desc: "Runs the Python video rendering pipeline (OpenCV + MoviePy) in a secure, isolated sandbox.",
      badge: "Daytona",
      icon: "⚙️",
    },
    {
      name: "Vercel",
      role: "Frontend & Hosting",
      desc: "Hosts the Next.js interface with streaming UI and real-time processing status updates.",
      badge: "Vercel",
      icon: "▲",
    },
  ];

  return (
    <section id="stack" className="py-24 bg-card/20">
      <div className="container">
        <FadeIn className="text-center mb-16">
          <span className="timecode mb-3 block">// TECH STACK</span>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Built on the Best{" "}
            <span className="text-amber-400">AI Infrastructure</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Every component in the pipeline is powered by a best-in-class API. No compromises, no custom model training required.
          </p>
        </FadeIn>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {stack.map((item, i) => (
            <FadeIn key={i} delay={i * 0.08}>
              <div className="studio-card studio-card-hover rounded-xl p-6 h-full">
                <div className="flex items-start justify-between mb-4">
                  <span className="text-3xl">{item.icon}</span>
                  <Badge variant="outline" className="text-xs border-amber-500/20 text-amber-400/70 font-mono">
                    {item.badge}
                  </Badge>
                </div>
                <h3 className="font-bold text-base mb-1">{item.name}</h3>
                <p className="text-amber-400 text-xs font-mono mb-3">{item.role}</p>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Personas Section ────────────────────────────────────────
function PersonasSection() {
  const personas = [
    {
      icon: Target,
      title: "The Solo Founder",
      subtitle: "Building on a tight budget",
      desc: "You're running your own ads and can't afford a $2,000 agency review. AdGuru gives you expert-level feedback before you spend a dollar on media.",
      tags: ["DTC Brands", "Indie Hackers", "Bootstrapped Startups"],
    },
    {
      icon: TrendingUp,
      title: "The Performance Marketer",
      subtitle: "Scaling ad campaigns",
      desc: "You manage high-volume campaigns and need to rapidly evaluate creative concepts. AdGuru gives you an objective, data-driven score on every creative before it goes live.",
      tags: ["Media Buyers", "Growth Teams", "Ad Agencies"],
    },
    {
      icon: Users,
      title: "The Content Creator",
      subtitle: "Making sponsored content",
      desc: "You produce UGC and sponsored videos for brands. AdGuru helps you ensure your content hits the marketing beats brands require — before you submit.",
      tags: ["UGC Creators", "Influencers", "Brand Partnerships"],
    },
  ];

  return (
    <section id="personas" className="py-24">
      <div className="container">
        <FadeIn className="text-center mb-16">
          <span className="timecode mb-3 block">// WHO IT'S FOR</span>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Built for Everyone Who{" "}
            <span className="text-amber-400">Runs Ads</span>
          </h2>
        </FadeIn>

        <div className="grid md:grid-cols-3 gap-6">
          {personas.map((p, i) => (
            <FadeIn key={i} delay={i * 0.12}>
              <div className="studio-card studio-card-hover rounded-xl p-8 h-full flex flex-col">
                <div className="w-12 h-12 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5">
                  <p.icon className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-xl font-bold mb-1">{p.title}</h3>
                <p className="text-amber-400 text-xs font-mono mb-4">{p.subtitle}</p>
                <p className="text-muted-foreground text-sm leading-relaxed flex-1 mb-5">{p.desc}</p>
                <div className="flex flex-wrap gap-2">
                  {p.tags.map((tag, j) => (
                    <Badge key={j} variant="secondary" className="text-xs font-normal">{tag}</Badge>
                  ))}
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Waitlist Section ────────────────────────────────────────
function WaitlistSection() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setSubmitted(true);
    toast.success("You're on the list! We'll be in touch soon.");
  };

  return (
    <section id="waitlist" className="py-32 relative overflow-hidden">
      <div className="absolute inset-0" style={{ backgroundImage: `url(${WAVEFORM_BG})`, backgroundSize: "cover", opacity: 0.4 }} />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />

      <div className="container relative z-10 text-center">
        <FadeIn>
          <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 font-mono text-xs px-3 py-1 mb-6">
            <span className="rec-dot" />
            EARLY ACCESS OPEN
          </Badge>
          <h2 className="text-5xl md:text-6xl font-bold mb-4 leading-tight">
            Be the First to Know
            <br />
            When We <span className="text-amber-400">Go Live</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-lg mx-auto mb-10">
            Join the waitlist and get early access, a free critique of your first ad, and founding member pricing.
          </p>

          {!submitted ? (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 bg-card border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-amber-500/50 transition-colors font-mono placeholder:text-muted-foreground"
              />
              <Button
                type="submit"
                className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 amber-glow"
              >
                Join Waitlist <ChevronRight className="ml-1 w-4 h-4" />
              </Button>
            </form>
          ) : (
            <div className="flex items-center justify-center gap-3 text-amber-400">
              <CheckCircle2 className="w-6 h-6" />
              <span className="font-semibold text-lg">You're on the list! We'll be in touch.</span>
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-4">No spam. Unsubscribe anytime.</p>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-border py-10">
      <div className="container flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center">
            <Play className="w-3 h-3 text-black fill-black" />
          </div>
          <span className="font-bold text-sm">AdGuru <span className="text-amber-400">AI</span></span>
        </div>
        <p className="text-xs text-muted-foreground font-mono">
          Built with Gemini · Fal.ai · ElevenLabs · Daytona · Vercel
        </p>
        <p className="text-xs text-muted-foreground">
          © 2026 AdGuru AI. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

// ─── Main Page ───────────────────────────────────────────────
export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <HeroSection />
      <StatsSection />
      <ProblemSection />
      <HowItWorksSection />
      <DemoSection />
      <TechStackSection />
      <PersonasSection />
      <WaitlistSection />
      <Footer />
    </div>
  );
}
