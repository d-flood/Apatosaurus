def quick_message(message, klass: str, timeout: int = 2):
    """klass: 'ok', 'warn', 'bad', 'info', 'plain'"""
    return f'<div class="box {klass} color bg" _="on load wait {timeout}s then remove me"><p>{message}</p></div>'

