import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Sparkles, UtensilsCrossed } from 'lucide-react';

export default function CategorySlider({ categories, selectedCategory, onSelectCategory }) {
  const { language, t } = useLanguage();

  return (
    <div className="mb-3 sm:mb-8">
      {/* Section Header — the "Food Categories / N Categories" block is desktop
          only. On a phone it cost a full 40px row above a strip of chips that is
          self-explanatory on its own. */}
      <div className="hidden sm:flex items-center justify-between mb-3 sm:mb-4 px-1">
        <h2 className="text-lg sm:text-xl font-bold text-neutral-900 flex items-center gap-2">
          <UtensilsCrossed className="w-5 h-5 text-[#e53939]" />
          <span>
            {language === 'gu'
              ? 'વાનગીઓની કેટેગરી'
              : language === 'hi'
              ? 'भोजन श्रेणियां'
              : 'Food Categories'}
          </span>
        </h2>
        <span className="text-xs text-neutral-500 font-medium">
          {categories.length} {language === 'gu' ? 'કેટેગરીઝ' : language === 'hi' ? 'श्रेणियां' : 'Categories'}
        </span>
      </div>

      {/* Category Chips with scroll gradient indicator.
          Mobile chips drop to a single 32px-tall line with no thumbnails or
          counts, so a dozen categories fit in about one and a half screens of
          horizontal scroll rather than three rows of tall cards. */}
      <div className="relative">
        <div
          className="flex items-center gap-1.5 sm:gap-2.5 overflow-x-auto pb-1 pt-0.5 scrollbar-thin scrollbar-thumb-neutral-200 scrollbar-track-transparent scroll-px-1 -mx-3 px-3 sm:mx-0 sm:px-0"
          style={{ scrollbarWidth: 'thin', msOverflowStyle: '-ms-autohiding-scrollbar' }}
        >
          {/* 'All' category */}
          <button
            type="button"
            onClick={() => onSelectCategory('all')}
            className={`flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl shrink-0 font-semibold text-[11px] sm:text-xs sm:text-sm border transition-all duration-200 cursor-pointer select-none whitespace-nowrap ${
              selectedCategory === 'all'
                ? 'bg-[#e53939] text-white border-[#e53939] shadow-md'
                : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400 hover:shadow-sm'
            }`}
          >
            <Sparkles className={`w-3 sm:w-3.5 h-3 sm:h-3.5 ${selectedCategory === 'all' ? 'text-white' : 'text-[#e53939]'}`} />
            <span>{t('allCategories')}</span>
          </button>

          {/* Dynamic categories from data */}
          {categories.map((cat) => {
            const isActive = selectedCategory === String(cat.id);
            const categoryName =
              language === 'gu'
                ? cat.name_gu
                : language === 'hi'
                  ? cat.name_hi
                  : cat.name_en;

            return (
              <button
                type="button"
                key={cat.id}
                onClick={() => onSelectCategory(String(cat.id))}
                className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl shrink-0 font-semibold text-[11px] sm:text-xs sm:text-sm border transition-all duration-200 cursor-pointer select-none whitespace-nowrap ${
                  isActive
                    ? 'bg-[#e53939] text-white border-[#e53939] shadow-md'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400 hover:shadow-sm'
                }`}
              >
                {cat.image_url && (
                  <img
                    src={cat.image_url}
                    alt={categoryName}
                    className="hidden sm:block w-6 h-6 sm:w-7 sm:h-7 rounded-full object-cover border-2 border-neutral-200"
                    loading="lazy"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                )}
                <span className="max-w-[92px] sm:max-w-[120px] truncate">{categoryName}</span>
                {cat.item_count !== undefined && (
                  <span
                    className={`hidden sm:inline text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isActive ? 'bg-white/25 text-white' : 'bg-neutral-100 text-neutral-500'
                    }`}
                  >
                    {cat.item_count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
