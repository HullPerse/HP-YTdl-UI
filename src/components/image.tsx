import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  quality?: number;
  type?: "cover" | "contain";
}

const isExternal = (url: string) =>
  url.startsWith("http") ||
  url.startsWith("ftp") ||
  url.startsWith("data:") ||
  url.startsWith("blob:");

const Image = ({
  src,
  alt,
  className,
  width,
  height,
  type = "cover",
  quality = 80,
  ...props
}: ImageProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [finalSrc, setFinalSrc] = useState(src);
  const [retryKey, setRetryKey] = useState(0);
  const attemptRef = useRef(0);

  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFinalSrc(src);
    setIsLoaded(false);
    attemptRef.current = 0;
  }, [src]);

  useEffect(() => {
    if (imgRef.current?.complete) {
      setIsLoaded(true);
    }
  }, [finalSrc, retryKey]);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
  }, []);

  const handleError = useCallback(() => {
    attemptRef.current += 1;
    if (attemptRef.current <= 2) {
      setRetryKey((k) => k + 1);
    } else {
      setFinalSrc("");
    }
  }, []);

  const showWebp = !isExternal(finalSrc) && !finalSrc.match(/\.(ico|svg)$/i);
  const webpSrc = showWebp
    ? `${finalSrc.split("?")[0]}?format=webp&quality=${quality}`
    : finalSrc;

  return (
    <div
      className={cn(
        "relative flex w-full items-center overflow-hidden",
        className,
      )}
      style={{
        aspectRatio: width && height ? `${width}/${height}` : undefined,
      }}
    >
      {finalSrc ? (
        showWebp ? (
          <picture key={retryKey}>
            <source srcSet={webpSrc} type="image/webp" />
            <img
              ref={imgRef}
              src={finalSrc}
              alt={alt}
              width={width}
              height={height}
              className={cn(
                "absolute inset-0 h-full w-full transition-opacity duration-300",
                type === "cover" ? "object-cover" : "object-contain",
                isLoaded ? "opacity-100" : "opacity-0",
              )}
              loading="lazy"
              decoding="async"
              onLoad={handleLoad}
              onError={handleError}
              {...props}
            />
          </picture>
        ) : (
          <img
            key={retryKey}
            ref={imgRef}
            src={finalSrc}
            alt={alt}
            width={width}
            height={height}
            className={cn(
              "absolute inset-0 h-full w-full transition-opacity duration-300",
              type === "cover" ? "object-cover" : "object-contain",
              isLoaded ? "opacity-100" : "opacity-0",
            )}
            loading="lazy"
            decoding="async"
            onLoad={handleLoad}
            onError={handleError}
            {...props}
          />
        )
      ) : (
        <div
          className="flex h-full w-full items-center justify-center border border-primary/20 bg-background/40"
          role="presentation"
          aria-hidden="true"
        >
          <span className="text-muted-foreground text-xs">Изображение</span>
        </div>
      )}
    </div>
  );
};

export default memo(Image);
