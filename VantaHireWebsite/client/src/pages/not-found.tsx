import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import Footer from "@/components/Footer";
import { Helmet } from "react-helmet-async";

export default function NotFound() {
  return (
    <>
      <Helmet>
        <title>Page Not Found | ealana</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="public-theme min-h-screen bg-background text-foreground w-full flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <Card className="w-full max-w-md mx-4 bg-muted/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <h1 className="text-2xl font-bold text-foreground">404 Page Not Found</h1>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              The page you're looking for doesn't exist or has been moved.
            </p>
          </CardContent>
        </Card>
      </div>
        <Footer />
      </div>
    </>
  );
}
