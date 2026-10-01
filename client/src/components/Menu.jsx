import React, { useState } from 'react';

const baseMenuItems = [
  // MILK ITEMS - CATEGORY 2
  { id: 1, name: 'Simple Chhas', basePrice: 11, category: 'Milk Items', categoryId: 2 },
  { id: 2, name: 'Special Chhas', basePrice: 17, category: 'Milk Items', categoryId: 2 },
  { id: 3, name: 'Dahi', basePrice: 22, category: 'Milk Items', categoryId: 2 },
  { id: 4, name: 'Milk', basePrice: 33, category: 'Milk Items', categoryId: 2 },
  { id: 5, name: 'Ghee', basePrice: 33, category: 'Milk Items', categoryId: 2 },
  { id: 6, name: 'Gol', basePrice: 22, category: 'Milk Items', categoryId: 2 },
  { id: 7, name: 'Butter (Vadki)', basePrice: 33, category: 'Milk Items', categoryId: 2 },

  // SWEET - CATEGORY 3
  { id: 8, name: 'Rotlano Churmo', basePrice: 77, category: 'Sweet', categoryId: 3, isSpecial: true },
  { id: 9, name: 'Churma Ladoo', basePrice: 22, category: 'Sweet', categoryId: 3 },
  { id: 10, name: 'Rasgulla', basePrice: 22, category: 'Sweet', categoryId: 3 },
  { id: 11, name: 'Gulab Jamun', basePrice: 22, category: 'Sweet', categoryId: 3, isPopular: true },

  // TEA & COFFEE - CATEGORY 4
  { id: 12, name: 'Tea', basePrice: 22, category: 'Tea & Coffee', categoryId: 4 },
  { id: 13, name: 'Coffee', basePrice: 28, category: 'Tea & Coffee', categoryId: 4 },
  { id: 14, name: 'Milk', basePrice: 33, category: 'Tea & Coffee', categoryId: 4 },

  // PAPAD - CATEGORY 14
  { id: 15, name: 'Roasted Papad', basePrice: 11, category: 'Papad', categoryId: 14 },
  { id: 16, name: 'Fried Papad', basePrice: 22, category: 'Papad', categoryId: 14 },
  { id: 17, name: 'Masala Papad', basePrice: 33, category: 'Papad', categoryId: 14, isPopular: true },
  { id: 18, name: 'Nagli Papad', basePrice: 22, category: 'Papad', categoryId: 14 },

  // RICE & KHICHDI - CATEGORY 12
  { id: 19, name: 'Jeera Rice', basePrice: 77, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 20, name: 'Plain Rice', basePrice: 55, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 21, name: 'Dal Rice', basePrice: 55, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 22, name: 'Veg. Pulav', basePrice: 88, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 23, name: 'Veg. Biryani', basePrice: 132, category: 'Rice & Khichdi', categoryId: 12, isPopular: true },
  { id: 24, name: 'Veg. Hyderabadi', basePrice: 165, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 25, name: 'Kaju Pulav', basePrice: 154, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 26, name: 'Paneer Pulav', basePrice: 154, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 27, name: 'Paneer Khichdi', basePrice: 143, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 28, name: 'Butter Khichadi', basePrice: 143, category: 'Rice & Khichdi', categoryId: 12, isSpecial: true },
  { id: 29, name: 'Cheese Khichadi', basePrice: 154, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 30, name: 'Kadhi Khichadi', basePrice: 55, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 31, name: 'Masala Rice', basePrice: 88, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 32, name: 'Punjabi Khichadi', basePrice: 110, category: 'Rice & Khichdi', categoryId: 12 },
  { id: 33, name: 'Tadka Khichadi', basePrice: 121, category: 'Rice & Khichdi', categoryId: 12 },

  // PUNJABI - CATEGORY 10
  { id: 34, name: 'Palak Paneer', basePrice: 165, category: 'Punjabi', categoryId: 10 },
  { id: 35, name: 'Paneer Matar', basePrice: 165, category: 'Punjabi', categoryId: 10 },
  { id: 36, name: 'Paneer Chatpata', basePrice: 165, category: 'Punjabi', categoryId: 10 },
  { id: 37, name: 'Paneer Kadhai', basePrice: 176, category: 'Punjabi', categoryId: 10 },
  { id: 38, name: 'Paneer Handi', basePrice: 176, category: 'Punjabi', categoryId: 10 },
  { id: 39, name: 'Paneer Balti', basePrice: 187, category: 'Punjabi', categoryId: 10 },
  { id: 40, name: 'Paneer Bhurji', basePrice: 176, category: 'Punjabi', categoryId: 10 },
  { id: 41, name: 'Paneer Butter Masala', basePrice: 176, category: 'Punjabi', categoryId: 10, isPopular: true },
  { id: 42, name: 'Paneer Tufani', basePrice: 176, category: 'Punjabi', categoryId: 10 },
  { id: 43, name: 'Paneer Tikka', basePrice: 154, category: 'Punjabi', categoryId: 10 },
  { id: 44, name: 'Paneer Tawa', basePrice: 176, category: 'Punjabi', categoryId: 10 },
  { id: 45, name: 'Paneer Pasanda', basePrice: 220, category: 'Punjabi', categoryId: 10, isSpecial: true },
  { id: 46, name: 'Paneer Angara', basePrice: 198, category: 'Punjabi', categoryId: 10, isSpecial: true },
  { id: 47, name: 'Cheese Angara', basePrice: 220, category: 'Punjabi', categoryId: 10 },
  { id: 48, name: 'Shahi Paneer', basePrice: 165, category: 'Punjabi', categoryId: 10 },
  { id: 49, name: 'Chana Paneer', basePrice: 165, category: 'Punjabi', categoryId: 10 },
  { id: 50, name: 'Paneer Aflatun', basePrice: 198, category: 'Punjabi', categoryId: 10 },
  { id: 51, name: 'Paneer Cheese', basePrice: 198, category: 'Punjabi', categoryId: 10 },
  { id: 52, name: 'Paneer Lasaniya', basePrice: 176, category: 'Punjabi', categoryId: 10 },
  { id: 53, name: 'Cheese Aflatun', basePrice: 220, category: 'Punjabi', categoryId: 10 },
  { id: 96, name: 'Mix Veg.', basePrice: 110, category: 'Punjabi', categoryId: 10 },
  { id: 97, name: 'Veg. Kolhapuri', basePrice: 176, category: 'Punjabi', categoryId: 10 },

  // SOUP - CATEGORY 6
  { id: 54, name: 'Manchow Soup', basePrice: 88, category: 'Soup', categoryId: 6 },
  { id: 55, name: 'Manchurian Soup', basePrice: 99, category: 'Soup', categoryId: 6 },
  { id: 56, name: 'Garlic Soup', basePrice: 99, category: 'Soup', categoryId: 6 },

  // STARTER - CATEGORY 5
  { id: 57, name: 'Manchurian Dry', basePrice: 88, category: 'Starter', categoryId: 5, isPopular: true },
  { id: 58, name: 'Paneer Chilli Dry', basePrice: 165, category: 'Starter', categoryId: 5 },
  { id: 59, name: 'Paneer Chilli Gravy', basePrice: 176, category: 'Starter', categoryId: 5 },
  { id: 60, name: 'Manchurian Gravy', basePrice: 88, category: 'Starter', categoryId: 5 },

  // NOODLES - CATEGORY 7
  { id: 61, name: 'Veg. Hakka Noodles', basePrice: 88, category: 'Noodles', categoryId: 7 },
  { id: 62, name: 'Veg. Schezwan Noodles', basePrice: 110, category: 'Noodles', categoryId: 7 },
  { id: 63, name: 'Manchurian Noodles', basePrice: 99, category: 'Noodles', categoryId: 7 },

  // CHINESE RICE - CATEGORY 8
  { id: 64, name: 'Veg. Fried Rice', basePrice: 99, category: 'Chinese Rice', categoryId: 8 },
  { id: 65, name: 'Veg. Schezwan Fried Rice', basePrice: 110, category: 'Chinese Rice', categoryId: 8 },
  { id: 66, name: 'Manchurian Fried Rice', basePrice: 99, category: 'Chinese Rice', categoryId: 8 },
  { id: 67, name: 'Chinese Pulav', basePrice: 88, category: 'Chinese Rice', categoryId: 8 },
  { id: 68, name: 'Chinese Bhel', basePrice: 143, category: 'Chinese Rice', categoryId: 8, isPopular: true },

  // SALAD - CATEGORY 15
  { id: 69, name: 'Tomato Salad', basePrice: 29, category: 'Salad', categoryId: 15 },
  { id: 70, name: 'Green Salad', basePrice: 39, category: 'Salad', categoryId: 15 },

  // KATHIYAVADI - CATEGORY 9
  { id: 71, name: 'Sev Tameta', basePrice: 88, category: 'Kathiyavadi', categoryId: 9, isPopular: true },
  { id: 72, name: 'Ringan Bharthu', basePrice: 110, category: 'Kathiyavadi', categoryId: 9, isSpecial: true },
  { id: 73, name: 'Mung Masala', basePrice: 99, category: 'Kathiyavadi', categoryId: 9 },
  { id: 74, name: 'Bharela Ringan', basePrice: 99, category: 'Kathiyavadi', categoryId: 9 },
  { id: 75, name: 'Bharela Karela', basePrice: 99, category: 'Kathiyavadi', categoryId: 9 },
  { id: 76, name: 'Bharela Marcha', basePrice: 99, category: 'Kathiyavadi', categoryId: 9 },
  { id: 77, name: 'Bharela Bhinda', basePrice: 88, category: 'Kathiyavadi', categoryId: 9 },
  { id: 78, name: 'Sev Bhaji', basePrice: 99, category: 'Kathiyavadi', categoryId: 9 },
  { id: 79, name: 'Sev Lasaniya', basePrice: 110, category: 'Kathiyavadi', categoryId: 9 },
  { id: 80, name: 'Lasaniya Batata', basePrice: 110, category: 'Kathiyavadi', categoryId: 9 },
  { id: 81, name: 'Suki Bhaji', basePrice: 88, category: 'Kathiyavadi', categoryId: 9 },
  { id: 82, name: 'Suki Bhaji (Farali)', basePrice: 99, category: 'Kathiyavadi', categoryId: 9 },
  { id: 83, name: 'Bhindi Fry', basePrice: 99, category: 'Kathiyavadi', categoryId: 9 },
  { id: 84, name: 'Bhindi Masala', basePrice: 110, category: 'Kathiyavadi', categoryId: 9 },
  { id: 85, name: 'Tameta Bharta', basePrice: 99, category: 'Kathiyavadi', categoryId: 9 },
  { id: 86, name: 'Dahi Tikhari', basePrice: 88, category: 'Kathiyavadi', categoryId: 9, isSpecial: true },

  // HOTEL SPECIAL - CATEGORY 1
  { id: 87, name: 'Special Darshan', basePrice: 242, category: 'Hotel Special', categoryId: 1, isSpecial: true },

  // DAL - CATEGORY 13
  { id: 88, name: 'Dal Fry', basePrice: 88, category: 'Dal', categoryId: 13 },
  { id: 89, name: 'Dal Fry Butter', basePrice: 99, category: 'Dal', categoryId: 13 },
  { id: 90, name: 'Dal Tadka', basePrice: 110, category: 'Dal', categoryId: 13, isPopular: true },
  { id: 91, name: 'Dal Tadka Butter', basePrice: 121, category: 'Dal', categoryId: 13 },

  // ROTI / ROTLA / PAROTHA - CATEGORY 11
  { id: 115, name: 'Plain Roti', basePrice: 11, category: 'Roti / Rotla / Parotha', categoryId: 11 },
  { id: 116, name: 'Butter Roti', basePrice: 17, category: 'Roti / Rotla / Parotha', categoryId: 11 },
  { id: 117, name: 'Bajri Rotlo Plain', basePrice: 22, category: 'Roti / Rotla / Parotha', categoryId: 11 },
  { id: 118, name: 'Bajri Rotlo Butter', basePrice: 28, category: 'Roti / Rotla / Parotha', categoryId: 11, isPopular: true },
  { id: 119, name: 'Bajri Rotlo Lasaniya', basePrice: 33, category: 'Roti / Rotla / Parotha', categoryId: 11 },
  { id: 120, name: 'Bajri Rotlo Lasaniya Butter', basePrice: 39, category: 'Roti / Rotla / Parotha', categoryId: 11, isSpecial: true },
  { id: 131, name: 'Tawa Paratha', basePrice: 22, category: 'Roti / Rotla / Parotha', categoryId: 11 },
  { id: 132, name: 'Tawa Butter Paratha', basePrice: 28, category: 'Roti / Rotla / Parotha', categoryId: 11 },
  { id: 135, name: 'Methi Thepla', basePrice: 55, category: 'Roti / Rotla / Parotha', categoryId: 11 },
  { id: 136, name: 'Aloo Paratha', basePrice: 55, category: 'Roti / Rotla / Parotha', categoryId: 11 },

  // HOTEL SPECIAL - CATEGORY 1
  { id: 137, name: 'Gujarati Thali', basePrice: 110, category: 'Hotel Special', categoryId: 1 },
  { id: 138, name: 'Punjabi Thali', basePrice: 199, category: 'Hotel Special', categoryId: 1 },
];

export default function Menu({ onAddToCart }) {
  const [selectedCategory, setSelectedCategory] = useState('All');

  const deliveryMenuItems = baseMenuItems.map((item) => ({
    ...item,
    price: Math.round(item.basePrice * 1.10)
  }));

  const categories = [
    'All',
    'Hotel Special',
    'Milk Items',
    'Sweet',
    'Tea & Coffee',
    'Starter',
    'Soup',
    'Noodles',
    'Chinese Rice',
    'Kathiyavadi',
    'Punjabi',
    'Roti / Rotla / Parotha',
    'Rice & Khichdi',
    'Dal',
    'Papad',
    'Salad'
  ];

  const filteredItems = selectedCategory === 'All'
    ? deliveryMenuItems
    : deliveryMenuItems.filter(item => item.category === selectedCategory);

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: '0 auto' }}>
      <header style={{ textAlign: 'center', marginBottom: '25px' }}>
        <h1 style={{ color: '#e23744', margin: '0 0 5px 0' }}>🍽️ Hotel Darshan</h1>
        <p style={{ fontWeight: 'bold', color: '#555', margin: 0 }}>Family Restaurant</p>
        <p style={{ color: '#888', fontSize: '13px', marginTop: '5px' }}>
          *Online delivery prices include a 10% service charge.
        </p>
      </header>

      <div style={styles.filterContainer}>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            style={{
              ...styles.filterBtn,
              backgroundColor: selectedCategory === cat ? '#e23744' : '#fff',
              color: selectedCategory === cat ? '#fff' : '#333',
              border: selectedCategory === cat ? '1px solid #e23744' : '1px solid #ccc',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      <div style={styles.grid}>
        {filteredItems.map((item) => (
          <div key={item.id} style={styles.card}>
            <h3 style={styles.title}>{item.name}</h3>
            <span style={styles.badge}>{item.category}</span>
            <p style={styles.price}>
              ₹{item.price}{' '}
              <span style={styles.originalPrice}>₹{item.basePrice}</span>
            </p>
            <button onClick={() => onAddToCart && onAddToCart(item)} style={styles.button}>
              Add to Cart
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  filterContainer: { display: 'flex', gap: '8px', marginBottom: '25px', flexWrap: 'wrap', justifyContent: 'center' },
  filterBtn: { padding: '8px 14px', borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '16px' },
  card: { padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px', textAlign: 'center', backgroundColor: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' },
  title: { fontSize: '15px', margin: '0 0 6px 0', color: '#222' },
  badge: { fontSize: '11px', color: '#777', backgroundColor: '#f5f5f5', padding: '2px 8px', borderRadius: '4px', alignSelf: 'center' },
  price: { fontSize: '17px', fontWeight: 'bold', color: '#27ae60', margin: '12px 0' },
  originalPrice: { fontSize: '12px', color: '#999', textDecoration: 'line-through', marginLeft: '6px' },
  button: { padding: '8px 12px', backgroundColor: '#e23744', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', width: '100%' }
};
