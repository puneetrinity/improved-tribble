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
      className={fullScreen
        ? "relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(75,142,240,0.16),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(52,209,122,0.14),_transparent_30%),linear-gradient(180deg,#f8fbff_0%,#eef4ff_100%)] px-6 py-12"
        : "relative flex min-h-[280px] items-center justify-center overflow-hidden rounded-[28px] border border-[rgba(61,68,96,0.08)] bg-[radial-gradient(circle_at_top,_rgba(75,142,240,0.14),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(52,209,122,0.12),_transparent_32%),linear-gradient(180deg,#fbfdff_0%,#f3f7ff_100%)] px-6 py-12"}
    >
      <div className="absolute inset-0 opacity-60">
        <div className="absolute left-[16%] top-[18%] h-28 w-28 rounded-full bg-[rgba(75,142,240,0.12)] blur-3xl" />
        <div className="absolute bottom-[16%] right-[18%] h-32 w-32 rounded-full bg-[rgba(52,209,122,0.12)] blur-3xl" />
        <div className="absolute right-[28%] top-[26%] h-20 w-20 rounded-full bg-[rgba(245,200,66,0.12)] blur-2xl" />
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(rgba(61,68,96,0.12)_0.8px,transparent_0.8px)] [background-size:18px_18px] opacity-[0.16]" />

      <div className="relative z-10 flex flex-col items-center text-center">
        <motion.div
          animate={{ y: [0, -10, 0], rotate: [0, -3, 3, 0] }}
          transition={{ duration: 3.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          className="relative flex h-28 w-28 items-center justify-center"
        >
          <motion.div
            animate={{ scale: [0.95, 1.1, 0.95], opacity: [0.28, 0.42, 0.28] }}
            transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            className="absolute h-24 w-24 rounded-full bg-[radial-gradient(circle,_rgba(75,142,240,0.3)_0%,_rgba(52,209,122,0.18)_48%,_transparent_72%)] blur-xl"
          />
          <motion.img
            src={ealanaMoth}
            alt="ealana moth"
            className="relative h-20 w-20 drop-shadow-[0_16px_24px_rgba(8,10,20,0.16)]"
            animate={{ rotate: [0, -4, 4, 0], scale: [1, 1.03, 0.99, 1] }}
            transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="mt-4 space-y-2"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.38em] text-[#4B8EF0]">
            ealana
          </div>
          <div className="text-xl font-semibold tracking-[-0.03em] text-[#111326]">
            {label}
          </div>
          <div className="mx-auto h-1.5 w-32 overflow-hidden rounded-full bg-[rgba(61,68,96,0.08)]">
            <motion.div
              className="h-full rounded-full bg-[linear-gradient(90deg,#4B8EF0_0%,#34D17A_58%,#F5C842_100%)]"
              animate={{ x: ["-100%", "100%"] }}
              transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
