// Page transition effects
document.addEventListener('DOMContentLoaded', function() {
  // Add fade-in effect on page load
  document.body.classList.add('fade-in');
  
  // Handle all navigation links
  const navLinks = document.querySelectorAll('a:not([href^="#"])');
  
  navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      // Skip external links and links that open in new tabs
      if (this.hostname !== window.location.hostname || this.target === '_blank') {
        return;
      }
      
      e.preventDefault();
      
      // Add fade-out effect
      document.body.classList.remove('fade-in');
      document.body.classList.add('fade-out');
      
      // Store the target URL
      const targetUrl = this.href;
      
      // Navigate after animation
      setTimeout(() => {
        window.location.href = targetUrl;
      }, 500);
    });
  });

  // Handle features link clicks
  const featuresLinks = document.querySelectorAll('a[href="home.html#features"], a[href="#features"]');
  
  featuresLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      
      // If we're already on the home page, just scroll to features
      if (window.location.pathname.endsWith('home.html')) {
        const featuresSection = document.getElementById('features');
        if (featuresSection) {
          // Add fade-out effect
          document.body.classList.add('fade-out');
          
          setTimeout(() => {
            featuresSection.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
            
            // Fade back in
            document.body.classList.remove('fade-out');
            document.body.classList.add('fade-in');
          }, 300);
        }
      } else {
        // If we're on another page, store the target and navigate to home
        sessionStorage.setItem('scrollToFeatures', 'true');
        
        // Add fade-out effect
        document.body.classList.remove('fade-in');
        document.body.classList.add('fade-out');
        
        setTimeout(() => {
          window.location.href = 'home.html';
        }, 500);
      }
    });
  });
  
  // Check if we need to scroll to features section (for home page)
  if (sessionStorage.getItem('scrollToFeatures') === 'true') {
    // Clear the flag
    sessionStorage.removeItem('scrollToFeatures');
    
    // Wait for the page to fully load
    setTimeout(() => {
      const featuresSection = document.getElementById('features');
      if (featuresSection) {
        featuresSection.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }, 500);
  }
}); 