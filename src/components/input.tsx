import { cn } from "@/lib/cn";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

const inputVariants = cva(
  "w-full bg-accent placeholder:text-muted text-text border-0 outline-0 transition-all duration-150",
  {
    variants: {
      size: {
        default: "p-2",
        sm: "p-1 text-sm",
        lg: "p-3 text-lg",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function Input({
  className,
  size,
  ...props
}: ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      data-slot="input"
      className={cn(inputVariants({ size, className }))}
      {...props}
    />
  );
}

export { Input, inputVariants };
