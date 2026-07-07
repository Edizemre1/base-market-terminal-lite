import {
  BadgeDollarSign,
  Database,
  KeyRound,
  Network,
  ShieldCheck,
  WalletCards
} from "lucide-react";

export const publicSafetyChecklist = [
  "No Mergen branding",
  "No private business logic",
  "No real API keys or backend secrets",
  "No real swaps, approvals, or transactions",
  "Mock Base token data only",
  "Demo risk labels only"
];

export const builderLogEntries = [
  {
    title: "MVP shell",
    detail:
      "Scaffolded a standalone Next.js app with TypeScript, Tailwind CSS, and a public-demo terminal shell."
  },
  {
    title: "Mock market model",
    detail:
      "Created a local token snapshot model with fictional demo addresses, market metrics, and risk flags."
  },
  {
    title: "Discovery screens",
    detail:
      "Built landing, dashboard, token detail, and swap preview routes from reusable UI components."
  },
  {
    title: "Safety posture",
    detail:
      "Kept all data local and disabled transaction execution so the app remains a public interface MVP."
  }
];

export const futureArchitectureItems = [
  {
    title: "Wallet connection",
    detail:
      "Add a wallet adapter boundary for public account state, chain checks, and read-only balances.",
    icon: WalletCards
  },
  {
    title: "Base market data",
    detail:
      "Replace mock rows with a provider module that can read indexed Base token data through public APIs.",
    icon: Database
  },
  {
    title: "Swap routing",
    detail:
      "Introduce a routing service interface that returns quotes before any transaction-building code exists.",
    icon: Network
  },
  {
    title: "Platform fee boundary",
    detail:
      "Keep fee policy as a future integration boundary. No fee calculation or paid-product logic is included.",
    icon: BadgeDollarSign
  },
  {
    title: "Secret management",
    detail:
      "Load provider keys only from deployment secrets when real integrations are added later.",
    icon: KeyRound
  },
  {
    title: "Risk labeling",
    detail:
      "Move from demo labels to a documented public ruleset only after data sources and review criteria are defined.",
    icon: ShieldCheck
  }
];
