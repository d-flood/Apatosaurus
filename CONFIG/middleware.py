import random
import string

from django.http import HttpRequest, HttpResponse
from django.shortcuts import render


def random_chars(length=4):
    return "".join(random.choice(string.ascii_letters) for _ in range(length))


def htmx_errors(get_response):

    def middleware(request: HttpRequest):

        response: HttpResponse = get_response(request)

        if request.htmx and response.status_code >= 400:
            context = {
                "toast_id": random_chars(),
                "toast_title": f"Error: {response.status_code}",
                "toast_message": f"{response.status_code} {response.reason_phrase}",
                "toast_type": "bad",
            }
            error_response = render(request, "scraps/toast.html", context, status=200)
            error_response["HX-Retarget"] = "toast-container"
            error_response["HX-Reswap"] = "afterbegin"

            return error_response

        return response

    return middleware
