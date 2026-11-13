const API_BASE = 'http://localhost:3001';

async function submitResult() {
    console.log('📥 Submitting result...');
    
    const requestId = 'req_1794578334518_kgob6d2jx';
    const result = {
        success: true,
        prompt: 'A majestic phoenix rising from flames, vibrant orange and red feathers, fantasy art, cinematic lighting, 8k',
        permanentUrls: [],
        temporaryUrls: [
            'https://flow.google.com/asb/ANqvLOaRL-YRHU4uDg3bqvv4TnUDINBj9D3PpjbvK-eoQmMwumL5KHGEAR5X6cBmEk-PnDCAwODVui9AxGnrbXDoGgL30mTIiyybwodZeHmaHpeidcRf8nCffgRGUNwL2BGyFGZmmqKge4EJbVXISa7vt83oRJmXvkhORs2Soxxj=s1600-rw',
            'https://flow.google.com/asb/ANqvLOYmnxGCJJDm13pRPeeTbAjv6Pm3GbtZyExm-0aEUWMC8OfZSifDlQX-IDRSqt1HrXkiRiEP9rRzw2h9vj2bUh9_itTEJj4X-tbc6l_Ph_Ucf43JYN6t5clv9pOzEX9ITEcJ5Vbln5quW8i13cKhssYE-Zn92pMJc1q9S569=',
            'https://flow.google.com/asb/ANqvLObVOtB6kynYnhkqRL7Q7Fi9dOLoIfku9mycV_2O9YDQV9Z9-j5zF8KFSYZgtVWK2Q_cAdNaWl9NCIxnIE5TlS1DnB3zz4SKfIrEx5HuLwjHnOSMpCkHHgW49SNHaf3qiVKBokU_ERKvYDFnq7vs596zGopkDW9F5LkbbpVKGA=',
            'https://flow.google.com/asb/ANqvLOYv58f3tWsG3twmn_6L-oJpa2gevnEWhS_q_4ydmWmWr07_WFNsQuMdaA670g3wCM9NafCRH6F5u139PGFLWKzodRyPqV1bG-efRZ82PfkWWVWXT9t1ATXEklkd_22NtRUIxP-0_VoBYJZdDIjS3zwo_pdmZ-fJPwufA_GvMw=',
            'https://flow.google.com/asb/ANqvLOaUjOUXQ4kN1O9KZVFpDiWkaZRp9YuFuhNI5CD3tGhWecc60GtdmXXr-y0gQUsj9oK-VI6whz-JBrYX7Hx-Me31bIRpqF7Jh7mjjxYMPOGAYbFdk1M24-iIa1PHbPz_igX9C3TcBOHHb7VEJVo256XrL0YJwa7rn4eqQTvSaQ=',
            'https://flow.google.com/asb/ANqvLOZHnFL2f2KRY1COWRUiHIRzgZSuAXS1oVQYKxgbqYrNjyBcXVzWXVlapp16FWigbT7TEhcqFlK2wx8o6ZTNelx65zvzPDThdxJ6uXwvUJyiwbXcbiGEFRgw5AfTFwolwa_3cSc0C6-UbrlLLKmdgSTVLFxpuT4W54UdVdNzww=',
            'https://flow.google.com/asb/ANqvLOYLymfPICCDpvJdy0QKkV_qN7zHDNHIlif149Xqwk7FtDb-AQU0OMDUfY_ovHtzSJUpd-9Ec09yXf0u9WtOvqOrUWvwX2LhcNl0HU2mgXFtrlpOTC3QX1zOStYLU3x2T3PbAnk6KbXoIBMyI0lRMs-SolRfT_1QzysseVO4RA=',
            'https://flow.google.com/asb/ANqvLOaPSyhXC4p4FXNu5TvkO6n8WfzZwyKD8QNjqPqP8u38C8GVG-ODj6XRFudwM4eDVrWuJ0OvH2MnMrJBscArQVK9CYvO8nYJtrvi7SQD3SACtLwSbcVKr1xiPNQ7D1CJGjdoL2y4TUkXlFblfHeCEQyO1shNRwUYZ6fZjiyN=',
            'https://flow.google.com/asb/ANqvLOYv58f3tWsG3twmn_6L-oJpa2gevnEWhS_q_4ydmWmWr07_WFNsQuMdaA670g3wCM9NafCRH6F5u139PGFLWKzodRyPqV1bG-efRZ82PfkWWVWXT9t1ATXEklkd_22NtRUIxP-0_VoBYJZdDIjS3zwo_pdmZ-fJPwufA_GvMw=',
            'https://flow.google.com/asb/ANqvLObVOtB6kynYnhkqRL7Q7Fi9dOLoIfku9mycV_2O9YDQV9Z9-j5zF8KFSYZgtVWK2Q_cAdNaWl9NCIxnIE5TlS1DnB3zz4SKfIrEx5HuLwjHnOSMpCkHHgW49SNHaf3qiVKBokU_ERKvYDFnq7vs596zGopkDW9F5LkbbpVKGA=',
            'https://flow.google.com/asb/ANqvLOYmnxGCJJDm13pRPeeTbAjv6Pm3GbtZyExm-0aEUWMC8OfZSifDlQX-IDRSqt1HrXkiRiEP9rRzw2h9vj2bUh9_itTEJj4X-tbc6l_Ph_Ucf43JYN6t5clv9pOzEX9ITEcJ5Vbln5quW8i13cKhssYE-Zn92pMJc1q9S569='
        ],
        finalUrls: [
            'https://flow.google.com/asb/ANqvLOaRL-YRHU4uDg3bqvv4TnUDINBj9D3PpjbvK-eoQmMwumL5KHGEAR5X6cBmEk-PnDCAwODVui9AxGnrbXDoGgL30mTIiyybwodZeHmaHpeidcRf8nCffgRGUNwL2BGyFGZmmqKge4EJbVXISa7vt83oRJmXvkhORs2Soxxj=s1600-rw',
            'https://flow.google.com/asb/ANqvLOYmnxGCJJDm13pRPeeTbAjv6Pm3GbtZyExm-0aEUWMC8OfZSifDlQX-IDRSqt1HrXkiRiEP9rRzw2h9vj2bUh9_itTEJj4X-tbc6l_Ph_Ucf43JYN6t5clv9pOzEX9ITEcJ5Vbln5quW8i13cKhssYE-Zn92pMJc1q9S569='
        ],
        timestamp: '2026-11-13T18:30:00.000Z'
    };
    
    try {
        const response = await fetch(`${API_BASE}/result/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, result })
        });
        
        const res = await response.json();
        console.log('✅ Submit result:', res);
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

submitResult();