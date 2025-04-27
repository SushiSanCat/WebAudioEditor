document.addEventListener('DOMContentLoaded', function() {
    // Load the footer content
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'components/footer.html', true); // Use async mode
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            // Add the footer to the page
            document.body.insertAdjacentHTML('beforeend', xhr.responseText);
        } else {
            console.error('Failed to load footer:', xhr.status, xhr.statusText);
        }
    };
    
    xhr.onerror = function() {
        console.error('Error loading footer');
    };
    
    xhr.send();
}); 