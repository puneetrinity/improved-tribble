import { Button } from "@/components/ui/button";
import Planet from "@/components/illustrations/Planet";
import { Mail, Phone, MapPin, Calendar, ChevronRight, AlertCircle } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Premium contact form component with enhanced animations
const ContactForm = () => {
  const [formState, setFormState] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    location: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormState({
      ...formState,
      [name]: value
    });
    
    // Clear validation error when user starts typing
    if (validationErrors[name]) {
      setValidationErrors({
        ...validationErrors,
        [name]: ''
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setValidationErrors({});
    
    try {
      // Send data to our API endpoint
      const response = await apiRequest(
        'POST',
        '/api/contact',
        formState
      );
      
      const result = await response.json();
      
      // Show success state
      setIsSubmitting(false);
      setSubmitted(true);
      
      toast({
        title: "Message Sent!",
        description: "Thank you for your message. We'll get back to you shortly.",
        variant: "default"
      });
      
      // Reset form after showing success message
      setTimeout(() => {
        setFormState({
          name: '',
          email: '',
          phone: '',
          company: '',
          location: '',
          message: ''
        });
        setSubmitted(false);
      }, 5000);
      
    } catch (error: any) {
      setIsSubmitting(false);
      
      console.error("Form submission error:", error);
      
      try {
        // Try to parse the error
        const errorData = JSON.parse(error.message.split(': ')[1]);
        
        // Handle validation errors
        if (errorData?.error && Array.isArray(errorData.error)) {
          const errorMap: Record<string, string> = {};
          errorData.error.forEach((err: any) => {
            errorMap[err.field] = err.message;
          });
          setValidationErrors(errorMap);
          
          toast({
            title: "Form Validation Error",
            description: "Please check the form for errors and try again.",
            variant: "destructive"
          });
        } else {
          throw new Error("Unknown error format");
        }
      } catch (parseError) {
        // Handle other errors
        toast({
          title: "Something went wrong",
          description: "Unable to submit your message. Please try again later.",
          variant: "destructive"
        });
      }
    }
  };

  return (
    <div className="bg-gradient-to-br from-[hsl(var(--vanta-dark))] to-[hsl(var(--vanta-dark))]/80 backdrop-blur-lg p-8 rounded-xl shadow-lg premium-card border border-white/5">
      {!submitted ? (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="mb-6">
            <h3 className="text-xl font-bold mb-2 animate-gradient-text">Send Us a Message</h3>
            <p className="text-sm text-white/60">
              Fields marked with <span className="text-[#FF5BA8]">*</span> are required
            </p>
          </div>
          
          <div className="space-y-5">
            <div className="relative">
              <label
                htmlFor="name"
                className={`block text-sm font-medium mb-1 transition-all duration-300 ${
                  focusedField === 'name' ? 'text-[#7B38FB]' : 'text-white/80'
                }`}
              >
                Your Name <span className="text-[#FF5BA8]">*</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formState.name}
                onChange={handleChange}
                onFocus={() => setFocusedField('name')}
                onBlur={() => setFocusedField(null)}
                required
                className={`w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 focus:border-[#7B38FB] focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-[#7B38FB] transition-all duration-300 ${
                  focusedField === 'name' ? 'premium-border' : ''
                }`}
                placeholder="John Doe"
              />
              {focusedField === 'name' && (
                <div className="absolute h-0.5 w-1/4 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] bottom-0 left-0 rounded-full animate-shine"></div>
              )}
            </div>
            
            <div className="relative">
              <label
                htmlFor="email"
                className={`block text-sm font-medium mb-1 transition-all duration-300 ${
                  focusedField === 'email' ? 'text-[#7B38FB]' : 'text-white/80'
                }`}
              >
                Email Address <span className="text-[#FF5BA8]">*</span>
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formState.email}
                onChange={handleChange}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                required
                className={`w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 focus:border-[#7B38FB] focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-[#7B38FB] transition-all duration-300 ${
                  focusedField === 'email' ? 'premium-border' : ''
                }`}
                placeholder="example@email.com"
              />
              {focusedField === 'email' && (
                <div className="absolute h-0.5 w-1/4 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] bottom-0 left-0 rounded-full animate-shine"></div>
              )}
            </div>
            
            <div className="relative">
              <label
                htmlFor="phone"
                className={`block text-sm font-medium mb-1 transition-all duration-300 ${
                  focusedField === 'phone' ? 'text-[#7B38FB]' : 'text-white/80'
                }`}
              >
                Phone Number <span className="text-white/40 text-xs">(Optional)</span>
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formState.phone || ''}
                onChange={handleChange}
                onFocus={() => setFocusedField('phone')}
                onBlur={() => setFocusedField(null)}
                className={`w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 focus:border-[#7B38FB] focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-[#7B38FB] transition-all duration-300 ${
                  focusedField === 'phone' ? 'premium-border' : ''
                }`}
                placeholder="9876543210"
              />
              {focusedField === 'phone' && (
                <div className="absolute h-0.5 w-1/4 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] bottom-0 left-0 rounded-full animate-shine"></div>
              )}
            </div>
            
            <div className="relative">
              <label
                htmlFor="company"
                className={`block text-sm font-medium mb-1 transition-all duration-300 ${
                  focusedField === 'company' ? 'text-[#7B38FB]' : 'text-white/80'
                }`}
              >
                Company <span className="text-white/40 text-xs">(Optional)</span>
              </label>
              <input
                type="text"
                id="company"
                name="company"
                value={formState.company}
                onChange={handleChange}
                onFocus={() => setFocusedField('company')}
                onBlur={() => setFocusedField(null)}
                className={`w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 focus:border-[#7B38FB] focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-[#7B38FB] transition-all duration-300 ${
                  focusedField === 'company' ? 'premium-border' : ''
                }`}
                placeholder="Your Organization"
              />
              {focusedField === 'company' && (
                <div className="absolute h-0.5 w-1/4 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] bottom-0 left-0 rounded-full animate-shine"></div>
              )}
            </div>
            
            <div className="relative">
              <label
                htmlFor="location"
                className={`block text-sm font-medium mb-1 transition-all duration-300 ${
                  focusedField === 'location' ? 'text-[#7B38FB]' : 'text-white/80'
                }`}
              >
                Location / City <span className="text-white/40 text-xs">(Optional)</span>
              </label>
              <input
                type="text"
                id="location"
                name="location"
                value={formState.location}
                onChange={handleChange}
                onFocus={() => setFocusedField('location')}
                onBlur={() => setFocusedField(null)}
                className={`w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 focus:border-[#7B38FB] focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-[#7B38FB] transition-all duration-300 ${
                  focusedField === 'location' ? 'premium-border' : ''
                }`}
                placeholder="New York, San Francisco, etc."
              />
              {focusedField === 'location' && (
                <div className="absolute h-0.5 w-1/4 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] bottom-0 left-0 rounded-full animate-shine"></div>
              )}
            </div>
            
            <div className="relative">
              <label
                htmlFor="message"
                className={`block text-sm font-medium mb-1 transition-all duration-300 ${
                  focusedField === 'message' ? 'text-[#7B38FB]' : 'text-white/80'
                }`}
              >
                Message <span className="text-[#FF5BA8]">*</span>
              </label>
              <textarea
                id="message"
                name="message"
                value={formState.message}
                onChange={handleChange}
                onFocus={() => setFocusedField('message')}
                onBlur={() => setFocusedField(null)}
                rows={4}
                required
                className={`w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 focus:border-[#7B38FB] focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-[#7B38FB] transition-all duration-300 resize-none ${
                  focusedField === 'message' ? 'premium-border' : ''
                }`}
                placeholder="How can we help you?"
              />
              {focusedField === 'message' && (
                <div className="absolute h-0.5 w-1/4 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] bottom-0 left-0 rounded-full animate-shine"></div>
              )}
            </div>
          </div>
          
          <Button 
            type="submit" 
            variant="gradient" 
            size="lg" 
            className="w-full rounded-lg hover:shadow-lg hover:scale-105 transform transition-all duration-300 mt-6"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center">
                <span className="animate-pulse-slow">Sending</span>
                <span className="ml-1 inline-block animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
                <span className="inline-block animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
                <span className="inline-block animate-pulse" style={{ animationDelay: '0.6s' }}>.</span>
              </span>
            ) : (
              "Send Message"
            )}
          </Button>
        </form>
      ) : (
        <div className="py-10 text-center animate-bounce-in">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] flex items-center justify-center animate-pulse-glow">
            <ChevronRight className="w-8 h-8 text-white transform rotate-90" />
          </div>
          <h3 className="text-2xl font-bold mb-3 animate-gradient-text">Thank You!</h3>
          <p className="text-white/80">Your message has been sent successfully. We'll get back to you shortly.</p>
          
          {/* Additional decorative elements */}
          <div className="flex justify-center mt-6 space-x-1">
            <div className="h-1 w-2 bg-[#7B38FB]/50 rounded-full animate-pulse-slow"></div>
            <div className="h-1 w-2 bg-[#7B38FB]/50 rounded-full animate-pulse-slow" style={{ animationDelay: '0.2s' }}></div>
            <div className="h-1 w-2 bg-[#7B38FB]/50 rounded-full animate-pulse-slow" style={{ animationDelay: '0.4s' }}></div>
          </div>
        </div>
      )}
    </div>
  );
};

const Contact = () => {
  const [isInView, setIsInView] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    
    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    
    return () => observer.disconnect();
  }, []);

  return (
    <section id="contact" className="bg-gradient-to-b from-[#2D1B69] to-[#1E0B40] relative overflow-hidden" ref={sectionRef}>
      {/* Premium background decorations */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
      <div className="absolute top-20 right-10 w-80 h-80 bg-blue-500/10 rounded-full blur-[40px] animate-pulse-slow"></div>
      <div className="absolute bottom-10 left-10 w-72 h-72 bg-purple-500/10 rounded-full blur-[40px] animate-pulse-slow" style={{ animationDelay: '1.5s' }}></div>
      <div className="absolute top-40 left-1/4 w-60 h-60 bg-pink-500/10 rounded-full blur-[40px] animate-pulse-slow" style={{ animationDelay: '0.8s' }}></div>
      
      {/* Animated particles */}
      <div className="absolute w-2 h-2 bg-blue-300/40 rounded-full top-1/4 right-1/4 animate-float-path" 
          style={{animationDelay: '0.6s', animationDuration: '18s'}}></div>
      <div className="absolute w-3 h-3 bg-purple-300/40 rounded-full bottom-1/3 left-1/3 animate-float-path" 
          style={{animationDelay: '1.2s', animationDuration: '15s'}}></div>
      
      <div className="container mx-auto px-4 py-24 relative z-10">
        <div className="max-w-5xl mx-auto">
          <div className={`text-center mb-16 ${isInView ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '0.2s' }}>
            <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mx-auto mb-6"></div>
            
            <h2 className="text-4xl md:text-5xl font-bold mb-6 animate-gradient-text inline-block">
              Let's Start Your Recruitment Journey
            </h2>
            
            <p className="text-lg text-white/80 max-w-2xl mx-auto leading-relaxed">
              Have questions or ready to elevate your recruitment process? 
              Reach out to us and discover how VantaHire can transform your hiring experience.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start">
            <div className={`transition-all duration-700 ${isInView ? 'animate-slide-left' : 'opacity-0 -translate-x-10'}`} style={{ animationDelay: '0.4s' }}>
              <div className="space-y-8">
                {/* Calendly CTA - Primary */}
                <div className="text-center md:text-left">
                  <h3 className="text-2xl font-bold mb-4 animate-gradient-text inline-block">
                    Ready to Transform Your Hiring?
                  </h3>
                  <p className="text-white/80 mb-6">
                    Schedule a free 30-minute consultation to discuss your recruitment needs.
                  </p>
                  <Button
                    variant="gradient"
                    size="xl"
                    className="rounded-full premium-card hover:scale-105 transform transition-all duration-300 group w-full"
                    onClick={() => window.open('https://calendly.com/vantahire/30min', '_blank')}
                  >
                    <Calendar className="w-5 h-5 mr-2 group-hover:animate-pulse" />
                    <span className="group-hover:tracking-wide transition-all duration-300">Schedule a Free Consultation</span>
                  </Button>
                </div>

                {/* Contact Information */}
                <div className="bg-gradient-to-br from-[hsl(var(--vanta-dark))] to-[hsl(var(--vanta-dark))]/80 backdrop-blur-lg p-8 rounded-xl shadow-lg premium-card border border-white/5">
                  <h3 className="text-xl font-bold mb-6 text-white/90">
                    Or Reach Us Directly
                  </h3>
                  <div className="space-y-6">
                    <div className="flex items-center group transition-all duration-300 hover:translate-x-2">
                      <div className="bg-gradient-to-br from-[#7B38FB] to-[#7B38FB]/80 p-3 rounded-full mr-4 flex items-center justify-center shadow-lg group-hover:shadow-[#7B38FB]/30 transition-all duration-300">
                        <Mail className="h-5 w-5 text-white" />
                      </div>
                      <a
                        href="mailto:hello@vantahire.com"
                        className="font-medium text-white/90 hover:text-[#FF5BA8] transition-all duration-300 group-hover:tracking-wide"
                      >
                        hello@vantahire.com
                      </a>
                    </div>
                    <div className="flex items-center group transition-all duration-300 hover:translate-x-2">
                      <div className="bg-gradient-to-br from-[#FF5BA8] to-[#FF5BA8]/80 p-3 rounded-full mr-4 flex items-center justify-center shadow-lg group-hover:shadow-[#FF5BA8]/30 transition-all duration-300">
                        <Phone className="h-5 w-5 text-white" />
                      </div>
                      <a
                        href="tel:+919742944825"
                        className="font-medium text-white/90 hover:text-[#FF5BA8] transition-all duration-300 group-hover:tracking-wide"
                      >
                        +91-9742944825
                      </a>
                    </div>
                    <div className="flex items-center group transition-all duration-300 hover:translate-x-2">
                      <div className="bg-gradient-to-br from-[#2D81FF] to-[#2D81FF]/80 p-3 rounded-full mr-4 flex items-center justify-center shadow-lg group-hover:shadow-[#2D81FF]/30 transition-all duration-300">
                        <MapPin className="h-5 w-5 text-white" />
                      </div>
                      <span className="font-medium text-white/90 transition-all duration-300 group-hover:tracking-wide">Bangalore, India</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className={`transition-all duration-700 ${isInView ? 'animate-slide-right' : 'opacity-0 translate-x-10'}`} style={{ animationDelay: '0.6s' }}>
              <ContactForm />
            </div>
          </div>
        </div>
      </div>
      
      {/* Bottom decorative accent */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#7B38FB]/30 to-transparent"></div>
    </section>
  );
};

export default Contact;
