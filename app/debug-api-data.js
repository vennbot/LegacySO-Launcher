/**
 * Debug script to check what data the LegacySO API is actually returning
 * Run with: node debug-api-data.js
 */

const axios = require('axios');

async function debugAPIData() {
  console.log('🔍 Debugging LegacySO API data...\n');
  
  try {
    // 1. Check avatars online
    console.log('1. Checking avatars online...');
    const avatarsResponse = await axios.get('https://api.legacyso.org/userapi/avatars/online?compact=true');
    console.log('Avatars online:', avatarsResponse.data.avatars_online_count);
    
    // 2. Check online lots
    console.log('\n2. Checking online lots...');
    const lotsResponse = await axios.get('https://api.legacyso.org/userapi/city/1/lots/online');
    const lots = lotsResponse.data.lots;
    console.log(`Found ${lots.length} online lots`);
    
    // 3. Show first few lots with their data
    console.log('\n3. Sample lot data:');
    const sampleLots = lots.slice(0, 3);
    
    for (let i = 0; i < sampleLots.length; i++) {
      const lot = sampleLots[i];
      console.log(`\nLot ${i + 1}:`);
      console.log(`  Location: ${lot.location}`);
      console.log(`  Avatars in lot: ${lot.avatars_in_lot}`);
      console.log(`  Name: ${lot.name || 'Unknown'}`);
      
      // Check if lot image exists
      const lotImageUrl = `https://api.legacyso.org/userapi/city/1/${lot.location}.png`;
      console.log(`  Image URL: ${lotImageUrl}`);
      
      try {
        const imageResponse = await axios.head(lotImageUrl);
        console.log(`  ✅ Image exists (${imageResponse.status})`);
      } catch (imageError) {
        console.log(`  ❌ Image missing (${imageError.response?.status || 'Network error'})`);
      }
      
      // Try to get lot details
      try {
        const detailsResponse = await axios.get(`https://api.legacyso.org/userapi/city/1/lots/location/${lot.location}`);
        const ownerId = detailsResponse.data.owner_id;
        console.log(`  Owner ID: ${ownerId}`);
        
        // Check avatar details
        try {
          const avatarResponse = await axios.get(`https://api.legacyso.org/userapi/avatars/?ids=${ownerId}`);
          const avatar = avatarResponse.data.avatars[0];
          console.log(`  Owner: ${avatar?.name || 'Unknown'}`);
          
          // Check avatar image
          const avatarImageUrl = `https://api.legacyso.org/userapi/avatars/${ownerId}.png`;
          try {
            const avatarImageResponse = await axios.head(avatarImageUrl);
            console.log(`  ✅ Avatar image exists (${avatarImageResponse.status})`);
          } catch (avatarImageError) {
            console.log(`  ❌ Avatar image missing (${avatarImageError.response?.status || 'Network error'})`);
          }
          
        } catch (avatarError) {
          console.log(`  ❌ Avatar details failed: ${avatarError.message}`);
        }
        
      } catch (detailsError) {
        console.log(`  ❌ Lot details failed: ${detailsError.message}`);
      }
    }
    
    // 4. Check blog data
    console.log('\n4. Checking blog data...');
    try {
      const blogResponse = await axios.get('https://legacyso.org/wp-json/wp/v2/posts?_embed&per_page=3');
      console.log(`Found ${blogResponse.data.length} blog posts`);
      
      blogResponse.data.forEach((post, index) => {
        console.log(`\nBlog Post ${index + 1}:`);
        console.log(`  Title: ${post.title.rendered}`);
        console.log(`  Featured Image: ${post.jetpack_featured_media_url || 'None'}`);
      });
    } catch (blogError) {
      console.log(`❌ Blog fetch failed: ${blogError.message}`);
    }
    
  } catch (error) {
    console.error('❌ API Debug failed:', error.message);
  }
}

debugAPIData();
