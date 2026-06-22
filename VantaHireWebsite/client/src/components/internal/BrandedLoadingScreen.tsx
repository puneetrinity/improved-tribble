import { motion } from "framer-motion";
import ealanaMoth from "@/assets/ealana-moth (1).svg";

interface BrandedLoadingScreenProps {
  label?: string;
  fullScreen?: boolean;
}

export default function BrandedLoadingScreen({
  label = "Loading your workspace...",
  fullScreen = false,
}: BrandedLoadingScreenProps) {
  return (
    <div
      className={
        fullScreen
          ? "fixed inset-0 z-[9999] flex items-center justify-center bg-[#080A14]"
          : "flex min-h-[240px] items-center justify-center rounded-[20px] border border-white/[0.06] bg-[rgba(255,255,255,0.02)]"
      }
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <motion.div
          animate={{ y: [0, -6, 0], rotate: [0, -3, 3, 0] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          className="relative flex h-14 w-14 items-center justify-center"
        >
          <motion.div
            animate={{ scale: [0.9, 1.1, 0.9], opacity: [0.18, 0.32, 0.18] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="absolute h-12 w-12 rounded-full bg-[radial-gradient(circle,rgba(75,142,240,0.4)_0%,rgba(52,209,122,0.2)_50%,transparent_72%)] blur-lg"
          />
          <img src={ealanaMoth} alt="ealana" className="relative h-9 w-9" />
        </motion.div>

        <div className="space-y-1">
          <p className="text-[0.78rem] font-medium tracking-[0.12em] uppercase text-[#4B8EF0]">
            ealana
          </p>
          <p className="text-[0.88rem] text-[#8891AA]">{label}</p>
        </div>

        <div className="h-[2px] w-24 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            className="h-full rounded-full bg-[linear-gradient(90deg,#4B8EF0_0%,#34D17A_100%)]"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
    </div>
  );
}
