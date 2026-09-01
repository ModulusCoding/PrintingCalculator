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

  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }, [images.length]);

  const goToIndex = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

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
    <div className="product-carousel" data-product-id={productId} ref={carouselRef} tabIndex={0}>
      <div className="product-carousel-track" ref={trackRef}>
        {images.map((src, index) => (
          <div key={src} className="product-carousel-slide">
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

      <style jsx>{`
        .product-carousel {
          position: relative;
          width: 100%;
          aspect-ratio: 4 / 5;
          overflow: hidden;
          background: #eaebe8;
          border-radius: inherit;
        }
        .product-carousel-track {
          display: flex;
          width: 100%;
          height: 100%;
          transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .product-carousel-slide {
          flex: 0 0 100%;
          width: 100%;
          height: 100%;
          position: relative;
        }
        .product-carousel-slide > div,
        .product-carousel-slide img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .product-carousel-placeholder {
          width: 100%;
          height: 100%;
          background: #e8e8e5;
        }
        .product-carousel-btn {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          z-index: 10;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.9);
          color: #152336;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s, background 0.2s, transform 0.2s;
          backdrop-filter: blur(4px);
        }
        .product-carousel:hover .product-carousel-btn,
        .product-carousel:focus-within .product-carousel-btn {
          opacity: 1;
        }
        .product-carousel-btn:hover {
          background: white;
          transform: translateY(-50%) scale(1.05);
        }
        .product-carousel-btn:focus-visible {
          opacity: 1;
          outline: 2px solid #ff4e26;
          outline-offset: 2px;
        }
        .product-carousel-btn-prev {
          left: 10px;
        }
        .product-carousel-btn-next {
          right: 10px;
        }
        .product-carousel-indicators {
          position: absolute;
          bottom: 12px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 6px;
          z-index: 10;
          padding: 4px 8px;
          background: rgba(255, 255, 255, 0.8);
          border-radius: 999px;
          backdrop-filter: blur(4px);
        }
        .product-carousel-indicator {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          border: none;
          background: rgba(21, 35, 54, 0.3);
          cursor: pointer;
          transition: background 0.2s, transform 0.2s;
        }
        .product-carousel-indicator:hover {
          background: rgba(21, 35, 54, 0.6);
          transform: scale(1.2);
        }
        .product-carousel-indicator.active {
          background: #152336;
        }
        .product-carousel-indicator:focus-visible {
          outline: 2px solid #ff4e26;
          outline-offset: 2px;
        }

        @media (max-width: 560px) {
          .product-carousel-btn {
            opacity: 1;
            width: 32px;
            height: 32px;
          }
          .product-carousel-indicators {
            bottom: 10px;
            gap: 5px;
          }
          .product-carousel-indicator {
            width: 6px;
            height: 6px;
          }
        }
      `}</style>
    </div>
  );
}