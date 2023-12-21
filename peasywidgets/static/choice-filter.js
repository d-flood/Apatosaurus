// on load scripts
// ##################################

// event listeners for choice-filter widgets on page load
document.addEventListener("DOMContentLoaded", () => {
  setEventListeners();
});

function setEventListeners() {
  document.querySelectorAll("input.choice-filter").forEach((input) => {
    let ulElem = document.getElementById(`${input.dataset.name}_ul`);
    let isFocusWithinUl = false;

    // show/hide choices (aka, replicating datalist behavior
    input.addEventListener("focus", () => {
      console.log("focus input");
      ulElem.style.display = "block";
    });
    input.addEventListener("click", () => {
      ulElem.style.display = "block";
    });
    input.addEventListener("keyup", () => {
      ulElem.style.display = "block";
    });
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (!isFocusWithinUl) {
          ulElem.style.display = "none";
          validateInput(input, ulElem);
        }
      }, 0);
    });
    ulElem.addEventListener("focusin", () => {
      isFocusWithinUl = true;
      ulElem.style.display = "block";
    });
    ulElem.addEventListener("focusout", () => {
      isFocusWithinUl = false;
      setTimeout(() => {
        if (!input.contains(document.activeElement) && !isFocusWithinUl) {
          ulElem.style.display = "none";
          validateInput(input, ulElem);
        }
      }, 0);
    });

    // filter options handler
    input.addEventListener("input", () => {
      filterOptions(input, ulElem);
    });

    // hide ulElem on exit keyup
    ulElem.addEventListener("keyup", (event) => {
      if (event.key === "Escape") {
        ulElem.style.display = "none";
        sendFocusForward(ulElem);
      }
    });

    // option button up/down handlers
    ulElem.querySelectorAll("li button").forEach((button) => {
      // use up/down arrows to navigate options
      button.addEventListener("keyup", (event) => {
        if (event.key === "ArrowDown") {
          sendFocusForward(button);
        } else if (event.key === "ArrowUp") {
          sendFocusBack(button);
        }
      });
    });

    // option button click handlers
    ulElem
      .querySelectorAll("li button.choice-filter-single")
      .forEach((button) =>
        button.addEventListener("click", () =>
          selectChoiceSingle(input.dataset.name, button)
        )
      );
    ulElem
      .querySelectorAll("li button.choice-filter-multi")
      .forEach((button) =>
        button.addEventListener("click", () =>
          selectChoiceMulti(input.dataset.name, button)
        )
      );
  });

  document.querySelectorAll("input.choice-filter-single").forEach((input) => {
    // set initial display for single choice filters whose value is empty
    // (when Django returns an invalid form, the display values are empty)
    if (input.value === "") {
      setInitialDisplay(input);
    }
  });
}

// FUNCTIONS
// ###############################################################################
// General ChoiceFilter Functions

// filter available options based on current input value
function filterOptions(input, ulElem) {
  input.classList.remove("valid");
  let liElems = ulElem.getElementsByTagName("li");
  let filter = input.value.toLowerCase();
  for (let liElem of liElems) {
    let button = liElem.getElementsByTagName("button")[0];
    let txtValue = button.textContent || button.innerText;
    if (txtValue.toLowerCase().indexOf(filter) > -1) {
      liElem.style.display = "block";
    } else {
      liElem.style.display = "none";
    }
  }
}

// check that input value matches one of the available options
function validateInput(input, ulElem) {
  // don't validate multi inputs
  if (input.classList.contains("choice-filter-multi")) {
    return;
  }
  let liElems = ulElem.getElementsByTagName("li");
  let filter = input.value.trim().toLowerCase();
  for (let liElem of liElems) {
    let button = liElem.getElementsByTagName("button")[0];
    let txtValue = button.textContent.trim().toLowerCase();
    if (txtValue === filter) {
      document.getElementById(`${input.dataset.name}_errors`).innerHTML = "";
      input.classList.add("valid");
      return;
    }
  }
  document.getElementById(`${input.dataset.name}_errors`).innerHTML =
    "That option does not exist";
  document.getElementById(`${input.dataset.name}_hidden_input`).value = "";
  input.classList.remove("valid");
}

function sendFocusForward(currentElem) {
  let focusableElems = Array.from(
    document.querySelectorAll(
      "div.admin-container a, div.admin-container button:not(.filter-widget), div.admin-container input, div.admin-container select, div.admin-container textarea, div.admin-container [tabindex]:not([tabindex='-1'])"
    )
  );
  // restrict focusable elements to those that are visible
  focusableElems = focusableElems.filter(
    (elem) => elem === currentElem || elem.offsetParent !== null
  );
  let currentIndex = focusableElems.indexOf(currentElem);
  // If the current element is not found, or it's the last element, focus the first element
  if (currentIndex === -1 || currentIndex === focusableElems.length - 1) {
    focusableElems[0].focus();
  } else {
    // focus the next element
    focusableElems[currentIndex + 1].focus();
  }
}

function sendFocusBack(currentElem) {
  let focusableElems = Array.from(
    document.querySelectorAll(
      "a, button, input, select, textarea, [tabindex]:not([tabindex='-1'])"
    )
  );
  let currentIndex = focusableElems.indexOf(currentElem);
  if (currentIndex === -1 || currentIndex === 0) {
    focusableElems[focusableElems.length - 1].focus();
  } else {
    focusableElems[currentIndex - 1].focus();
  }
}

// ###############################################################################
// ChoiceFilterSingle Functions

// add selected option to input
function selectChoiceSingle(name, button) {
  let visible_input = document.getElementById(`${name}_visible_input`);
  visible_input.value = button.innerText;
  document.getElementById(`${name}_hidden_input`).value = button.dataset.value;
  button.parentElement.parentElement.style.display = "none";
  validateInput(visible_input, document.getElementById(`${name}_ul`));
}

function setInitialDisplay(inputElem) {
  let ulElem = document.getElementById(`${inputElem.dataset.name}_ul`);
  let liElems = ulElem.getElementsByTagName("li");
  for (let liElem of liElems) {
    let button = liElem.getElementsByTagName("button")[0];
    if (button.dataset.value === inputElem.dataset.value) {
      inputElem.value = button.innerText;
      return;
    }
  }
}

// ###############################################################################
// ChoiceFilterMulti Functions

function choiceFilterRemoveItem(elem) {
  let li = elem.parentElement;
  li.parentElement.removeChild(li);
  // keep focus near the removed item
  let nextItem = li.parentElement.firstElementChild;
  if (nextItem) {
    nextItem.firstElementChild.focus();
  }
}

// add selected option to selected list
function selectChoiceMulti(name, button) {
  targetUl = document.getElementById(button.dataset.target);

  // Check if item already exists
  for (let item of targetUl.getElementsByTagName("input")) {
    if (item.value === button.dataset.value) {
      document.getElementById(`${name}_errors`).innerHTML =
        "Item already added.";
      return;
    }
  }

  // Add visible item name; add hidden input with value
  let newItem = `
    <li class="choice-filter-flex-row">
        <input class="choice-filter-multi-selected" type="text" value="${button.innerText}" readonly>
        <input type="hidden" name="${name}" value="${button.dataset.value}">
        <button type="button" class="choice-filter-rm-btn choice-filter-red" title="Remove ${button.innerText}"
            onclick="choiceFilterRemoveItem(this)">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
        </button>
    </li>`;
  if (button.dataset.single === "true") {
    targetUl.innerHTML = newItem;
  } else {
    targetUl.innerHTML += newItem;
  }

  // clear errors
  document.getElementById(`${name}_errors`).innerHTML = "";
  button.parentElement.parentElement.style.display = "none";
  // focus the created input
  targetUl.lastElementChild.firstElementChild.focus();
}
