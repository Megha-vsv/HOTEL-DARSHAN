import React, { useEffect, useState } from 'react';
import { Utensils } from 'lucide-react';

export default function FoodImage({
  src,
  alt,
  category,
  className = 'w-full h-full object-cover'
}) {
  const [imageError, setImageError] = useState(false);

  // Reset image error whenever the image URL changes
  useEffect(() => {
    setImageError(false);
  }, [src]);

  const imageSource = src || '';

  if (!imageSource || imageError) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-amber-50 to-red-50 flex flex-col items-center justify-center p-4 text-center border-b border-neutral-100">
        <div className="w-10 h-10 rounded-full bg-[#e53935]/10 flex items-center justify-center mb-2">
          <Utensils className="w-5 h-5 text-[#e53935]" />
        </div>

        <span className="font-black text-sm text-neutral-800 tracking-tight">
          Hotel Darshan
        </span>

        <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mt-0.5">
          {category || 'Authentic Taste'}
        </span>
      </div>
    );
  }

  return (
    <img
      src={imageSource}
      alt={alt || 'Hotel Darshan food'}
      className={className}
      onError={() => setImageError(true)}
      loading="lazy"
    />
  );
}