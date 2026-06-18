import { motion } from "framer-motion";
import ealanaMoth from "@/assets/ealana-moth (1).svg";

export default function FullPageLoader() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#080A14]">
      <div className="flex flex-col items-center gap-4">
        <motion.div
          animate={{ y: [0, -6, 0], rotate: [0, -3, 3, 0] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          className="relative flex h-16 w-16 items-center justify-center"
        >
          <motion.div
            animate={{ scale: [0.9, 1.1, 0.9], opacity: [0.2, 0.35, 0.2] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="absolute h-14 w-14 rounded-full bg-[radial-gradient(circle,rgba(75,142,240,0.4)_0%,rgba(52,209,122,0.2)_50%,transparent_72%)] blur-lg"
          />
          <img src={ealanaMoth} alt="ealana" className="relative h-10 w-10" />
        </motion.div>

        <div className="h-[2px] w-28 overflow-hidden rounded-full bg-white/[0.06]">
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
