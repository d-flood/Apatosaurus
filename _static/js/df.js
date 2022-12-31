if (localStorage.getItem('theme')) {
    var theme = localStorage.getItem('theme')
    document.documentElement.classList.add(theme)
    if (theme === 'dark') {
        document.getElementById('toggle-dark-theme').style.display = 'none';
        document.getElementById('toggle-light-theme').style.display = 'inline-block';
    } else {
        document.getElementById('toggle-dark-theme').style.display = 'inline-block';
        document.getElementById('toggle-light-theme').style.display = 'none';
    }
}
function toggleTheme(event) {
    var theme = event.currentTarget.getAttribute('theme')
    if (theme === 'dark') {
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        document.getElementById('toggle-dark-theme').style.display = 'none';
        document.getElementById('toggle-light-theme').style.display = 'inline-block';
    } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        localStorage.setItem('theme', 'light');
        document.getElementById('toggle-dark-theme').style.display = 'inline-block';
        document.getElementById('toggle-light-theme').style.display = 'none';
    }
}

document.getElementById('toggle-dark-theme').addEventListener('mouseup', toggleTheme)
document.getElementById('toggle-light-theme').addEventListener('mouseup', toggleTheme)