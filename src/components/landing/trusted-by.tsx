import {
  Activity,
  BarChart3,
  LineChart,
  MessageCircle,
  MessageSquare,
  PlayCircle,
  Search,
  Send,
  TrendingUp,
  Users,
} from "lucide-react";
import Container from "./container";

const tools = [
  { label: "Google Analytics 4", icon: BarChart3 },
  { label: "Search Console", icon: Search },
  { label: "PostHog", icon: Activity },
  { label: "Ahrefs", icon: LineChart },
  { label: "Semrush", icon: TrendingUp },
  { label: "YouTube", icon: PlayCircle },
  { label: "LinkedIn", icon: Users },
  { label: "Slack", icon: MessageSquare },
  { label: "Telegram", icon: Send },
  { label: "Discord", icon: MessageCircle },
];

export default function TrustedBy() {
  const row = [...tools, ...tools];

  return (
    <section className="border-t border-white/5 py-16">
      <Container>
        <p className="text-center text-sm text-[var(--color-landing-muted)]">
          Connects to the analytics, SEO, and delivery tools you already run
        </p>
      </Container>

      <div className="relative mt-8 overflow-hidden">
        <div className="flex w-max animate-landing-marquee gap-16">
          {row.map((tool, i) => (
            <div
              key={`${tool.label}-${i}`}
              className="flex items-center gap-2 whitespace-nowrap text-white/40"
            >
              <tool.icon size={20} />
              <span className="text-base font-medium">{tool.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
