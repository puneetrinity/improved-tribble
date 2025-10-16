import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import Footer from "@/components/Footer";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="flex-1 flex items-center justify-center">
        <Card className="w-full max-w-md mx-4 bg-white/10 backdrop-blur-sm border-white/20">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <h1 className="text-2xl font-bold text-white">404 Page Not Found</h1>
            </div>

            <p className="mt-4 text-sm text-white/70">
              The page you're looking for doesn't exist or has been moved.
            </p>
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
