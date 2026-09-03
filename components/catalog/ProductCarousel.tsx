"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ProductCarouselProps {
  images: string[];
  productName: string;
  productId: string;
}

export function ProductCarousel({ images, productName, productId }: ProductCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchDeltaXRef = useRef<number>(0);
  const touchDeltaYRef = useRef<number>(0);

  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }, [images.length]);

  const goToIndex = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (images.length <= 1) return;
    const touch = e.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    touchDeltaXRef.current = 0;
    touchDeltaYRef.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null || images.length <= 1) return;
    const touch = e.touches[0];
    touchDeltaXRef.current = touch.clientX - touchStartXRef.current;
    touchDeltaYRef.current = touch.clientY - touchStartYRef.current;
  };

  const handleTouchEnd = () => {
    if (touchStartXRef.current === null || images.length <= 1) return;

    const deltaX = touchDeltaXRef.current;
    const deltaY = touchDeltaYRef.current;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    const minSwipeDistance = 40;

    // Se o movimento for predominantemente horizontal e superior ao limite de ativação
    if (absX > minSwipeDistance && absX > absY * 1.2) {
      if (deltaX < 0) {
        goToNext();
      } else {
        goToPrev();
      }
    }

    touchStartXRef.current = null;
    touchStartYRef.current = null;
    touchDeltaXRef.current = 0;
    touchDeltaYRef.current = 0;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!carouselRef.current?.contains(document.activeElement)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNext();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [goToPrev, goToNext]);

  const loadedIndices = useMemo(() => {
    const indices = new Set<number>();
    indices.add(currentIndex);
    if (images.length > 1) {
      const nextIndex = currentIndex === images.length - 1 ? 0 : currentIndex + 1;
      indices.add(nextIndex);
      const prevIndex = currentIndex === 0 ? images.length - 1 : currentIndex - 1;
      indices.add(prevIndex);
    }
    return indices;
  }, [currentIndex, images.length]);

  if (images.length <= 1) {
    const src = images[0] || "/images/catalogo/mod-001-luminaria-shoji.webp";
    return (
      <div className="product-carousel" data-product-id={productId}>
        <div className="product-carousel-track" ref={trackRef}>
          <div className="product-carousel-slide">
            <Image
              src={src}
              alt={productName}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="product-carousel"
      data-product-id={productId}
      ref={carouselRef}
      tabIndex={0}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="product-carousel-track"
        ref={trackRef}
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {images.map((src, index) => (
          <div key={`${src}-${index}`} className="product-carousel-slide">
            {loadedIndices.has(index) ? (
              <Image
                src={src}
                alt={`${productName} — imagem ${index + 1} de ${images.length}`}
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover"
                loading={index === 0 ? "eager" : "lazy"}
                priority={index === 0}
              />
            ) : (
              <div className="product-carousel-placeholder" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="product-carousel-btn product-carousel-btn-prev"
        onClick={goToPrev}
        aria-label={`Imagem anterior de ${productName}`}
        aria-controls={`carousel-${productId}`}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>

      <button
        type="button"
        className="product-carousel-btn product-carousel-btn-next"
        onClick={goToNext}
        aria-label={`Próxima imagem de ${productName}`}
        aria-controls={`carousel-${productId}`}
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="product-carousel-indicators" role="tablist" aria-label="Selecionar imagem">
        {images.map((_, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === currentIndex}
            aria-label={`Ir para imagem ${index + 1} de ${images.length}`}
            onClick={() => goToIndex(index)}
            className={`product-carousel-indicator ${index === currentIndex ? "active" : ""}`}
          />
        ))}
      </div>


    </div>
  );
}