import { cn } from "@/lib/cn";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Children, type ComponentProps } from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm text-text disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none border cursor-pointer disabled:cursor-not-allowed font-extrabold transition-all-[100ms, ease-in-out] hover:bg-white/5 active:bg-white/10 transition-all duration-150 overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary border-border",
        error: "bg-error/50 border-border hover:bg-error/70 active:bg-error/40",
        success:
          "bg-success/50 border-border hover:bg-success/70 active:bg-success/40",
        outline: "border-border bg-background",
        secondary: "bg-secondary border-border text-background",
        accent: "bg-accent border-border",
        ghost: "border-transparent bg-transparent hover:bg-transparent",
        link: "underline-offset-4 hover:underline border-transparent bg-transparent",
      },
      size: {
        default: "h-11 px-6 py-2 has-[>svg]:px-4",
        sm: "h-9 gap-1.5 px-4 has-[>svg]:px-3",
        lg: "h-14 px-8 text-base has-[>svg]:px-6",
        icon: "size-11",
        "icon-sm": "size-9",
        "icon-lg": "size-14",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  }) {
  const Comp = asChild ? "span" : "button";

  return (
    <Comp
      data-slot="button"
      disabled={loading || disabled}
      className={cn(buttonVariants({ variant, size, className }))}
      children={loading ? <Loader2 className="size-4 animate-spin" /> : children}
      {...props}
    />
  );
}

export { Button, buttonVariants };
