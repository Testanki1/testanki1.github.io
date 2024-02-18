const axios = require('axios');
const fs = require('fs');

const targetUrl = 'https://balancer.eu.tankionline.com/datacenter';
let previousContent = '';

function checkWebpage() {
  axios.get(targetUrl)
    .then(response => {
      const currentContent = response.data;

      if (currentContent !== previousContent) {
        // Content has changed, log it
        const timestamp = new Date().toISOString();
        const logMessage = `${timestamp}: Content changed on ${targetUrl}\n`;

        fs.appendFile('log.txt', logMessage, (err) => {
          if (err) throw err;
          console.log('Log entry added.');
        });

        // Update previousContent for the next check
        previousContent = currentContent;
      }
    })
    .catch(error => {
      console.error('Error fetching webpage:', error);
    });
}

// Run the check every 1 hour (adjust as needed)
setInterval(checkWebpage, 3600000);
