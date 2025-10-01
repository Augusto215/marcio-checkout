// Countdown timer
let totalSeconds = 6 * 60 + 59; // 6 minutos e 59 segundos = 419 segundos

function updateCountdown() {
    const countdownElement = document.getElementById("countdown");
    const ofertaExpiradaElement = document.getElementById("oferta-expirada");
    
    if (!countdownElement) return; // Sair se elemento não existir
    
    if (totalSeconds <= 0) {
        countdownElement.innerHTML = "00:00";

        if (ofertaExpiradaElement) {
            ofertaExpiradaElement.innerHTML = "¡Oferta expirada!";
        }

        return;
    }
    
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    countdownElement.innerHTML = 
        String(minutes).padStart(2, '0') + ":" + 
        String(seconds).padStart(2, '0');
    
    totalSeconds--; // Decrementa 1 segundo a cada chamada
}

setInterval(updateCountdown, 1000);
updateCountdown();

// Form validation
const form = document.getElementById('checkoutForm');
if (form) {
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Validar campos obrigatórios
        const nombre = document.getElementById('nombre').value;
        const email = document.getElementById('email').value;
        const telefono = document.getElementById('telefono').value;
        
        if (!nombre || !email || !telefono) {
            alert('Por favor, completa todos los campos obrigatorios');
            return;
        }
        
        // Iniciar processo de pagamento
        processPayment(nombre, email, telefono);
    });
}

// Formatação de campos dentro do DOMContentLoaded principal
document.addEventListener('input', function(e) {
    // Formatação do telefone boliviano - formato: +591 7123 4567
    if (e.target.placeholder === '+591 7123 4567') {
        let value = e.target.value.replace(/\D/g, '');
        
        // Se não começar com 591, adiciona automaticamente
        if (value.length > 0 && !value.startsWith('591')) {
            if (value.length <= 3 && value !== '591') {
                value = '591' + value;
            } else if (value.length > 3) {
                value = '591' + value;
            }
        }
        
        // Formatar: +591 X XXX XXXX (total: 11 dígitos)
        if (value.length <= 11) {
            if (value.length <= 3) {
                e.target.value = '+' + value;
            } else if (value.length <= 4) {
                e.target.value = '+' + value.substring(0, 3) + ' ' + value.substring(3);
            } else if (value.length <= 7) {
                e.target.value = '+' + value.substring(0, 3) + ' ' + value.substring(3, 4) + ' ' + value.substring(4);
            } else {
                e.target.value = '+' + value.substring(0, 3) + ' ' + value.substring(3, 4) + ' ' + value.substring(4, 7) + ' ' + value.substring(7, 11);
            }
        } else {
            // Limita a 11 dígitos no total
            value = value.substring(0, 11);
            e.target.value = '+' + value.substring(0, 3) + ' ' + value.substring(3, 4) + ' ' + value.substring(4, 7) + ' ' + value.substring(7, 11);
        }
    }
});