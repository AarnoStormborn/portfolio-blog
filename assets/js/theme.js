// assets/js/theme.js

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const sunIcon = document.getElementById('sun-icon');
    const moonIcon = document.getElementById('moon-icon');

    // Function to apply the selected theme
    const applyTheme = (theme) => {
        if (theme === 'dark') {
            document.body.setAttribute('data-theme', 'dark');
            sunIcon.classList.add('d-none');
            moonIcon.classList.remove('d-none');
        } else {
            document.body.removeAttribute('data-theme');
            sunIcon.classList.remove('d-none');
            moonIcon.classList.add('d-none');
        }
    };

    // Get the saved theme from localStorage or use system preference
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    let currentTheme = savedTheme ? savedTheme : 'light';

    // Apply the initial theme
    applyTheme(currentTheme);

    // Event listener for the toggle button
    themeToggle.addEventListener('click', () => {
        currentTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', currentTheme);
        applyTheme(currentTheme);
    });
});
