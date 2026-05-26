import { motion } from "framer-motion";
import ealanaMoth from "@/assets/ealana-moth (1).svg";

export default function FullPageLoader() {
  return (
    <div className="min-h-screen w-full overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(75,142,240,0.14),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(52,209,122,0.12),_transparent_32%),linear-gradient(180deg,#fbfdff_0%,#f2f7ff_100%)] text-foreground">
      <div className="relative flex min-h-screen flex-col items-center justify-center px-6">
        <div className="absolute inset-0 bg-[radial-gradient(rgba(61,68,96,0.12)_0.8px,transparent_0.8px)] [background-size:18px_18px] opacity-[0.16]" />
        <div className="absolute left-[20%] top-[22%] h-32 w-32 rounded-full bg-[rgba(75,142,240,0.12)] blur-3xl" />
        <div className="absolute bottom-[20%] right-[22%] h-36 w-36 rounded-full bg-[rgba(52,209,122,0.12)] blur-3xl" />
        <div className="absolute right-[30%] top-[30%] h-24 w-24 rounded-full bg-[rgba(245,200,66,0.12)] blur-2xl" />

        <div className="relative z-10 flex flex-col items-center gap-5">
          <motion.div
            className="relative flex h-28 w-28 items-center justify-center"
            animate={{ x: [0, 10, -6, 0], y: [0, -12, 4, 0], rotate: [0, -4, 3, 0] }}
            transition={{ duration: 3.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          >
            <motion.div
              className="absolute h-24 w-24 rounded-full bg-[radial-gradient(circle,_rgba(75,142,240,0.28)_0%,_rgba(52,209,122,0.18)_48%,_transparent_72%)] blur-xl"
              animate={{ scale: [0.92, 1.08, 0.96, 0.92], opacity: [0.24, 0.4, 0.28, 0.24] }}
              transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />
            <motion.img
              src={ealanaMoth}
              alt="ealana moth"
              className="relative h-20 w-20 drop-shadow-[0_18px_28px_rgba(8,10,20,0.16)]"
              animate={{ rotate: [0, -6, 6, 0], scale: [1, 1.04, 0.98, 1] }}
              transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute -right-12 top-3 h-2 w-2 rounded-full bg-[#4B8EF0]"
              animate={{ x: [0, 16, 30], y: [0, -8, -16], opacity: [0, 0.8, 0] }}
              transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
            />
            <motion.div
              className="absolute -left-10 bottom-5 h-1.5 w-1.5 rounded-full bg-[#34D17A]"
              animate={{ x: [0, -12, -24], y: [0, 6, 10], opacity: [0, 0.7, 0] }}
              transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeOut", delay: 0.4 }}
            />
            <motion.div
              className="absolute right-0 -top-3 h-1.5 w-1.5 rounded-full bg-[#F5C842]"
              animate={{ x: [0, 8, 18], y: [0, -10, -18], opacity: [0, 0.65, 0] }}
              transition={{ duration: 1.7, repeat: Number.POSITIVE_INFINITY, ease: "easeOut", delay: 0.8 }}
            />
          </motion.div>

          <div className="text-center">
            <p className="font-outfit text-xl font-semibold tracking-[0.18em] text-[#111326]">
              EALANA
            </p>
            <p className="mt-2 text-sm text-[#667085]">
              Loading workspace...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
