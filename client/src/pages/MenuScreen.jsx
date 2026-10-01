// Food DeliveryApp/client/src/pages/MenuScreen.jsx

import React, { useState } from 'react';
import { menuCategories, menuItems, restaurantInfo } from '../data/menu';

export default function MenuScreen() {
  const [selectedCategory, setSelectedCategory] = useState("All");

  const filteredItems = selectedCategory === "All"
    ? menuItems
    : menuItems.filter(item => item.category === selectedCategory);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      {/* Header Section */}
      <div className="max-w-7xl mx-auto mb-8 text-center sm:text-left">
        <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
          {restaurantInfo.name}
        </h1>
        <p className="mt-2 text-sm text-amber-700 font-medium">
          {restaurantInfo.cuisine}
        </p>
      </div>

      {/* Categories Horizontal Filter */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex items-center space-x-3 overflow-x-auto pb-4 scrollbar-hide">
          <button
            onClick={() => setSelectedCategory("All")}
            className={`px-5 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors duration-200 ${
              selectedCategory === "All"
                ? "bg-amber-600 text-white shadow-md"
                : "bg-white text-gray-700 hover:bg-amber-50 border border-gray-200"
            }`}
          >
            All Items
          </button>
          {menuCategories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-5 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors duration-200 ${
                selectedCategory === category
                  ? "bg-amber-600 text-white shadow-md"
                  : "bg-white text-gray-700 hover:bg-amber-50 border border-gray-200"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Menu Grid */}
      <div className="max-w-7xl mx-auto">
        <h2 className="text-xl font-bold text-gray-800 mb-6 border-b pb-2">
          {selectedCategory === "All" ? "Full Menu" : selectedCategory}
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((item) => (
            <div 
              key={item.id} 
              className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden border border-gray-100 flex flex-col justify-between"
            >
              <div className="relative h-48 w-full overflow-hidden bg-gray-100">
                <img
                  src={item.image}
                  alt={item.name}
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                />
                <span className="absolute top-3 right-3 bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-300">
                  Veg
                </span>
              </div>
              
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-bold text-gray-900">{item.name}</h3>
                    <span className="text-lg font-bold text-amber-600">₹{item.price}</span>
                  </div>
                  <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                    {item.description}
                  </p>
                </div>

                <button 
                  className="w-full mt-2 bg-amber-600 hover:bg-amber-700 text-white font-medium py-2 px-4 rounded-xl transition-colors duration-200 flex items-center justify-center space-x-2"
                >
                  <span>Add to Order</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}